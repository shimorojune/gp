import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HEADER_SIZE, type Packet, PacketId, parsePacket } from '@gp/telemetry'
import { describe, expect, it } from 'vitest'
import { buildPacket, writeLap } from '../../telemetry/test/build.ts'
import {
  HistoryDb,
  type LapRecord,
  SessionCollector,
  assignSeason,
  careerOfSeason,
  listCareers,
  mergeCareers,
  renameCareer,
  timeAway,
  timeAwayBrief,
  unassignedSeasons,
} from '../src/index.ts'

const parsed = (buf: Buffer): Packet => {
  const r = parsePacket(buf)
  if (!r.ok) throw new Error(r.reason)
  return r.packet
}
const lap = (n: number, ms: number): LapRecord => ({
  lap: n,
  lapMs: ms,
  s1Ms: 25000,
  s2Ms: 30000,
  s3Ms: ms - 55000,
  valid: true,
  tyre: 'Soft',
  tyreAge: n,
  fuelKg: 10,
  position: 5,
  setupKey: null,
  flashback: false,
})

describe('flashbacks and session end in the collector', () => {
  it('drops laps a flashback rewinds past, marks later incidents undone, and sees SEND', () => {
    const c = new SessionCollector(0)
    const session = buildPacket(PacketId.Session, { sessionUID: 5n })
    session.writeUInt8(2, HEADER_SIZE + 8) // formula: F2
    c.feed(parsed(session), 0)
    const lapAt = (t: number, f: Parameters<typeof writeLap>[2]) => {
      const b = buildPacket(PacketId.LapData, { sessionUID: 5n, sessionTime: t })
      writeLap(b, 0, f)
      c.feed(parsed(b), t * 1000)
    }
    const event = (t: number, code: string, fill?: (b: Buffer) => void) => {
      const b = buildPacket(PacketId.Event, { sessionUID: 5n, sessionTime: t })
      b.write(code, HEADER_SIZE, 'latin1')
      fill?.(b)
      c.feed(parsed(b), t * 1000)
    }
    lapAt(1, { lapNum: 1, position: 5 })
    lapAt(81, { lapNum: 2, position: 5, lastLapMs: 80000 })
    lapAt(160, { lapNum: 3, position: 5, lastLapMs: 79000 })
    // A warning on lap 3, then a flashback to 150 s: lap 2 (done at 160 s) never happened.
    event(165, 'PENA', (b) => {
      b.writeUInt8(5, HEADER_SIZE + 4)
      b.writeUInt8(7, HEADER_SIZE + 5)
      b.writeUInt8(0, HEADER_SIZE + 6)
    })
    event(170, 'FLBK', (b) => {
      b.writeUInt32LE(9000, HEADER_SIZE + 4)
      b.writeFloatLE(150, HEADER_SIZE + 8)
    })
    lapAt(150.1, { lapNum: 2, position: 5 })
    lapAt(161, { lapNum: 3, position: 5, lastLapMs: 78000 })
    lapAt(240, { lapNum: 4, position: 5, lastLapMs: 79500 })
    event(241, 'SEND')
    const [r] = c.finish()
    expect(r!.formula).toBe('F2')
    expect(r!.car).toBeNull() // no participants packet, so no team yet
    expect(r!.ended).toBe(true)
    expect(r!.laps.map((l) => [l.lap, l.lapMs])).toEqual([
      [1, 80000],
      [2, 78000],
      [3, 79500],
    ])
    const warning = r!.incidents.find((i) => i.kind === 'warning')
    expect(warning?.undone).toBe(true)
    const fb = r!.incidents.find((i) => i.kind === 'flashback')
    expect(fb?.detail).toBe('flashback used, 20s back')
    expect(fb?.undone).toBeFalsy()
  })
})

describe('restarts', () => {
  const record = (uid: string, laps: LapRecord[], startedAt: string, extra = {}) => {
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
      startedAt,
      durationS: 300,
      finishPos: null,
      ended: false,
      ...extra,
    }
  }
  const statuses = (db: HistoryDb) =>
    db.db.prepare('SELECT uid, status, replaced_by FROM sessions ORDER BY started_at').all()

  it('marks the earlier attempt restarted when the same session starts again from lap 1', () => {
    const db = new HistoryDb(':memory:')
    db.saveSession(record('1', [lap(1, 81000), lap(2, 80500)], '2026-11-20T18:00:00.000Z'), 'a')
    // Five minutes long, back on track two minutes after it stopped.
    db.saveSession(record('2', [lap(1, 80900)], '2026-11-20T18:07:00.000Z'), 'b')
    expect(statuses(db)).toEqual([
      { uid: '1', status: 'restarted', replaced_by: '2' },
      { uid: '2', status: 'abandoned', replaced_by: null },
    ])
  })

  it('leaves a copy read again after an app restart alone (same lap times)', () => {
    const db = new HistoryDb(':memory:')
    db.saveSession(record('1', [lap(1, 81000), lap(2, 80500)], '2026-11-20T18:00:00.000Z'), 'a')
    db.saveSession(
      record('2', [lap(1, 81000), lap(2, 80500), lap(3, 80200)], '2026-11-20T18:06:00.000Z'),
      'b',
    )
    expect(statuses(db).map((r) => (r as { status: string }).status)).not.toContain('restarted')
  })

  it("doesn't link a session that ran to its end, or one an hour later", () => {
    const db = new HistoryDb(':memory:')
    db.saveSession(record('1', [lap(1, 81000)], '2026-11-20T18:00:00.000Z', { ended: true }), 'a')
    db.saveSession(record('2', [lap(1, 80000)], '2026-11-20T18:07:00.000Z'), 'b')
    db.saveSession(record('3', [lap(1, 79000)], '2026-11-20T19:30:00.000Z'), 'c')
    expect(statuses(db).map((r) => (r as { status: string }).status)).toEqual([
      'finished',
      'abandoned',
      'abandoned',
    ])
  })
})

describe('careers above seasons', () => {
  const careerSession = (uid: string, seasonLink: number, startedAt: string) => {
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
      laps: [lap(1, 80000)],
      program: 'career' as const,
      seasonLink,
      weekendLink: seasonLink + Number(uid),
      team: 'McLaren',
      startedAt,
    }
  }

  it('lists a new season as unassigned, then files it under a new or existing career', () => {
    const db = new HistoryDb(':memory:')
    db.saveSession(careerSession('1', 100, '2026-10-01T18:00:00.000Z'), 'a')
    db.saveSession(careerSession('2', 200, '2026-11-01T18:00:00.000Z'), 'b')
    expect(unassignedSeasons(db).map((s) => [s.seasonLink, s.sessions])).toEqual([
      [100, 1],
      [200, 1],
    ])
    const id = assignSeason(db, 100, { newCareer: ' McLaren career ' }, '2026-11-21T10:00:00.000Z')
    assignSeason(db, 200, { careerId: id })
    expect(unassignedSeasons(db)).toEqual([])
    expect(careerOfSeason(db, 200)).toEqual({ id, name: 'McLaren career', season: 2 })
    // Filing the same season again keeps its number.
    assignSeason(db, 200, { careerId: id })
    expect(listCareers(db)[0]!.seasons.map((s) => s.number)).toEqual([1, 2])
    renameCareer(db, id, 'Papaya years')
    expect(listCareers(db)[0]!.name).toBe('Papaya years')
    expect(() => assignSeason(db, 999, { careerId: id })).toThrow(/No season/)
    expect(() => assignSeason(db, 100, { newCareer: '  ' })).toThrow(/name/)
    expect(() => assignSeason(db, 100, { careerId: 'nope' })).toThrow(/No such career/)
  })

  it('merges one career into another, appending its seasons', () => {
    const db = new HistoryDb(':memory:')
    db.saveSession(careerSession('1', 100, '2026-10-01T18:00:00.000Z'), 'a')
    db.saveSession(careerSession('2', 200, '2026-11-01T18:00:00.000Z'), 'b')
    const a = assignSeason(db, 100, { newCareer: 'A' })
    const b = assignSeason(db, 200, { newCareer: 'B' })
    mergeCareers(db, b, a)
    const list = listCareers(db)
    expect(list.map((c) => c.name)).toEqual(['A'])
    expect(list[0]!.seasons.map((s) => [s.seasonLink, s.number])).toEqual([
      [100, 1],
      [200, 2],
    ])
    expect(() => mergeCareers(db, a, a)).toThrow(/different/)
  })

  it('seeds seasons from career sessions when a v5 database is opened', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'gp-v5-')), 'gp.db')
    const db = new HistoryDb(file)
    db.saveSession(careerSession('1', 300, '2026-10-01T18:00:00.000Z'), 'a')
    db.db.exec(`DROP TABLE seasons; DROP TABLE careers;
      ALTER TABLE sessions DROP COLUMN status; ALTER TABLE sessions DROP COLUMN replaced_by;
      ALTER TABLE sessions DROP COLUMN ended; ALTER TABLE sessions DROP COLUMN formula;
      ALTER TABLE sessions DROP COLUMN car; ALTER TABLE incidents DROP COLUMN undone;
      PRAGMA user_version = 5`)
    db.close()
    const again = new HistoryDb(file)
    expect(unassignedSeasons(again).map((s) => [s.seasonLink, s.team])).toEqual([[300, 'McLaren']])
    expect(again.db.prepare('SELECT status, car FROM sessions').get()).toEqual({
      status: 'finished',
      car: 'McLaren',
    })
    again.close()
  })
})

describe('time away', () => {
  const sim = (uid: string, startedAt: string) => {
    const c = new SessionCollector(0)
    c.feed(parsed(buildPacket(PacketId.Session, { sessionUID: BigInt(uid) })), 0)
    const a = buildPacket(PacketId.LapData, { sessionUID: BigInt(uid) })
    writeLap(a, 0, { lapNum: 1, position: 1 })
    c.feed(parsed(a), 1)
    const b = buildPacket(PacketId.LapData, { sessionUID: BigInt(uid) })
    writeLap(b, 0, { lapNum: 2, position: 1, lastLapMs: 80000 })
    c.feed(parsed(b), 2)
    return { ...c.finish()[0]!, laps: [lap(1, 80000)], startedAt }
  }

  it('reports the gap since the last session and eases in after a long one', () => {
    const db = new HistoryDb(':memory:')
    const now = new Date('2026-11-21T19:00:00.000Z')
    expect(timeAwayBrief(timeAway(db, now), now)).toMatch(/First session/)
    db.saveSession(sim('1', '2026-11-01T18:00:00.000Z'), 'a')
    db.saveSession(sim('2', '2026-11-10T18:00:00.000Z'), 'b')
    db.saveSession(sim('3', '2026-11-21T18:59:00.000Z'), 'c')
    const t = timeAway(db, now, '3')
    expect(t.lastAt).toBe('2026-11-10T18:00:00.000Z')
    expect(t.days).toBe(11)
    expect(t.sessionsLast7Days).toBe(0)
    const brief = timeAwayBrief(t, now)
    expect(brief).toMatch(/Last drove 11 days ago/)
    expect(brief).toMatch(/Long gap/)
    const soon = timeAway(db, new Date('2026-11-11T19:00:00.000Z'))
    expect(soon.days).toBe(1)
    expect(timeAwayBrief(soon)).not.toMatch(/Long gap/)
  })
})
