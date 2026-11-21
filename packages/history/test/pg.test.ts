import { type Packet, PacketId, parsePacket } from '@gp/telemetry'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildPacket, writeLap } from '../../telemetry/test/build.ts'
import {
  HistoryDb,
  HistorySync,
  type LapRecord,
  PG_MIGRATIONS,
  PgStore,
  SessionCollector,
  assignSeason,
  careerOfSeason,
  exportSession,
  importSession,
  listCareers,
  payloadHash,
  renameCareer,
} from '../src/index.ts'

/**
 * Payload round trips always run. The Postgres part needs a throwaway database:
 * GP_TEST_PG=postgresql://user@host:port/db (it drops and recreates the gp_* tables there).
 */
const PG_URL = process.env.GP_TEST_PG

const parsed = (buf: Buffer): Packet => {
  const r = parsePacket(buf)
  if (!r.ok) throw new Error(r.reason)
  return r.packet
}
const lap = (n: number, ms: number, setupKey: string | null = null): LapRecord => ({
  lap: n,
  lapMs: ms,
  s1Ms: 28000,
  s2Ms: 35000,
  s3Ms: ms - 63000,
  valid: n !== 2,
  tyre: 'Medium',
  tyreAge: n,
  fuelKg: 20 - n,
  wearPct: n * 3.5,
  position: 6,
  setupKey,
  flashback: n === 3,
})
function record(uid: string, laps: LapRecord[]) {
  const c = new SessionCollector(0)
  c.feed(parsed(buildPacket(PacketId.Session, { sessionUID: BigInt(uid) })), 0)
  const a = buildPacket(PacketId.LapData, { sessionUID: BigInt(uid) })
  writeLap(a, 0, { lapNum: 1, position: 1 })
  c.feed(parsed(a), 1)
  const b = buildPacket(PacketId.LapData, { sessionUID: BigInt(uid) })
  writeLap(b, 0, { lapNum: 2, position: 1, lastLapMs: 80000 })
  c.feed(parsed(b), 2)
  return {
    ...c.finish()[0]!,
    laps,
    startedAt: `2026-11-${10 + (Number(uid) % 10)}T18:00:00.000Z`,
    setups: { s1: { frontWing: 30 } as never },
    incidents: [
      { lap: 3, kind: 'flashback' as const, detail: 'flashback used', sessionTime: 210.5 },
    ],
  }
}
function seeded(): HistoryDb {
  const db = new HistoryDb(':memory:')
  db.saveSession(
    record(
      '41',
      [1, 2, 3, 4].map((n) => lap(n, 89000 + n * 100)),
    ),
    'a.gprec',
  )
  db.saveSession(
    record(
      '42',
      [1, 2, 3].map((n) => lap(n, 90000 + n)),
    ),
    'b.gprec',
  )
  db.addTrackIncident({ trackId: 7, sessionUid: '41', kind: 'spin', atM: 1234.5, detail: 'Copse' })
  db.setProfile('Strong single lap.', 'engineer', '2026-11-20T10:00:00.000Z')
  return db
}

describe('session payloads', () => {
  it('round-trip a session through export and import unchanged', () => {
    const a = seeded()
    const p = exportSession(a, '41')!
    expect(p.laps).toHaveLength(4)
    expect(p.trackIncidents).toHaveLength(1)
    expect(p.session).not.toHaveProperty('id')
    const b = new HistoryDb(':memory:')
    importSession(b, p)
    expect(payloadHash(exportSession(b, '41')!)).toBe(payloadHash(p))
    // Importing again replaces, never duplicates.
    importSession(b, p)
    expect((b.db.prepare('SELECT COUNT(*) AS n FROM laps').get() as { n: number }).n).toBe(4)
  })
})

describe.skipIf(!PG_URL)('Postgres sync', () => {
  let store: PgStore
  beforeAll(async () => {
    const c = new pg.Client({ connectionString: PG_URL })
    await c.connect()
    await c.query(
      'DROP TABLE IF EXISTS gp_seasons, gp_careers, gp_track_incidents, gp_traces, gp_classification, gp_incidents, gp_laps, gp_sessions, gp_setups, gp_profile, gp_migrations CASCADE',
    )
    await c.end()
    store = new PgStore(PG_URL!)
  })
  afterAll(() => store?.close())

  it('pushes everything once, pulls it into an empty copy, and pushes only what changed', async () => {
    const mac = seeded()
    const sync = new HistorySync(mac, store)
    expect(sync.localStatus().pending).toBe(2)
    const first = await sync.sync()
    expect(first).toMatchObject({ pushed: 2, pulled: 0, pending: 0, error: null })
    expect(await store.migrate()).toBe(PG_MIGRATIONS.length)

    const again = await sync.sync()
    expect(again.pushed).toBe(0)

    // A new install pulls everything, including the profile.
    const fresh = new HistoryDb(':memory:')
    const s2 = await new HistorySync(fresh, store).sync()
    expect(s2).toMatchObject({ pulled: 2, pushed: 0, error: null })
    for (const uid of ['41', '42'])
      expect(payloadHash(exportSession(fresh, uid)!)).toBe(payloadHash(exportSession(mac, uid)!))
    expect(fresh.profile()?.text).toBe('Strong single lap.')

    // A debrief written later changes the payload: only that session goes up again.
    mac.setSummary(
      mac.db.prepare("SELECT id FROM sessions WHERE uid = '42'").get()!.id as number,
      'P6',
    )
    expect(sync.localStatus().pending).toBe(1)
    expect((await sync.sync()).pushed).toBe(1)
    const remote = await store.pullSession('42')
    expect(remote?.session.summary).toBe('P6')
  })

  it('carries careers and seasons both ways, newest edit winning', async () => {
    const mac = seeded()
    mac.db
      .prepare(
        "INSERT INTO seasons (season_link, team, first_seen, updated_at) VALUES (77, 'McLaren', '2026-11-01', '2026-11-01')",
      )
      .run()
    const id = assignSeason(mac, 77, { newCareer: 'McLaren' }, '2026-11-20T10:00:00.000Z')
    await new HistorySync(mac, store).sync()
    const other = new HistoryDb(':memory:')
    const otherSync = new HistorySync(other, store)
    await otherSync.sync()
    expect(careerOfSeason(other, 77)).toEqual({ id, name: 'McLaren', season: 1 })
    renameCareer(other, id, 'Papaya', '2026-11-21T10:00:00.000Z')
    await otherSync.sync()
    await new HistorySync(mac, store).sync()
    expect(listCareers(mac)[0]!.name).toBe('Papaya')
  })

  it('reports a dead connection instead of throwing, and keeps the work pending', async () => {
    const dead = new PgStore('postgresql://gp@127.0.0.1:1/none')
    const s = await new HistorySync(seeded(), dead).sync()
    expect(s.error).toBeTruthy()
    expect(s.pending).toBe(2)
    await dead.close()
  })
})
