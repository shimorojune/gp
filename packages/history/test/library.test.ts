import { type Packet, PacketId, parsePacket } from '@gp/telemetry'
import { describe, expect, it } from 'vitest'
import { buildPacket, writeLap } from '../../telemetry/test/build.ts'
import {
  HistoryDb,
  type LapRecord,
  SessionCollector,
  assignSeason,
  listSessions,
  sessionDetail,
} from '../src/index.ts'

const parsed = (buf: Buffer): Packet => {
  const r = parsePacket(buf)
  if (!r.ok) throw new Error(r.reason)
  return r.packet
}
const lap = (n: number, ms: number, tyre = 'Soft', age = n, wear = n * 2): LapRecord => ({
  lap: n,
  lapMs: ms,
  s1Ms: 25000,
  s2Ms: 30000,
  s3Ms: ms - 55000,
  valid: n !== 2,
  tyre,
  tyreAge: age,
  fuelKg: 10,
  wearPct: wear,
  position: 5,
  setupKey: null,
  flashback: false,
})
function record(uid: string, extra: Record<string, unknown>) {
  const c = new SessionCollector(0)
  c.feed(parsed(buildPacket(PacketId.Session, { sessionUID: BigInt(uid) })), 0)
  const a = buildPacket(PacketId.LapData, { sessionUID: BigInt(uid) })
  writeLap(a, 0, { lapNum: 1, position: 1 })
  c.feed(parsed(a), 1)
  const b = buildPacket(PacketId.LapData, { sessionUID: BigInt(uid) })
  writeLap(b, 0, { lapNum: 2, position: 1, lastLapMs: 80000 })
  c.feed(parsed(b), 2)
  return { ...c.finish()[0]!, laps: [lap(1, 80000)], ...extra }
}

describe('debrief library', () => {
  const db = new HistoryDb(':memory:')
  db.saveSession(
    record('1', {
      program: 'career',
      seasonLink: 9,
      weekendLink: 90,
      team: 'McLaren',
      track: 'Monza',
      startedAt: '2026-11-01T18:00:00.000Z',
    }),
    'a',
  )
  db.saveSession(
    record('2', {
      sessionType: 'Time Trial',
      mode: 'Time Trial',
      car: 'Ferrari',
      startedAt: '2026-11-02T18:00:00.000Z',
    }),
    'b',
  )
  db.saveSession(
    record('3', {
      startedAt: '2026-11-03T18:00:00.000Z',
      laps: [
        lap(1, 81000),
        lap(2, 80000),
        lap(3, 80500),
        lap(4, 82000, 'Medium', 0, 0),
        lap(5, 81000, 'Medium', 1, 3),
      ],
      incidents: [
        { lap: 2, kind: 'warning', detail: 'corner cutting', sessionTime: 150, undone: true },
      ],
    }),
    'c',
  )
  const career = assignSeason(db, 9, { newCareer: 'Papaya' })

  it('lists newest first with program, career and pending flags', () => {
    const all = listSessions(db, {}, new Set(['3']))
    expect(all.map((s) => [s.uid, s.program, s.pendingSync])).toEqual([
      ['3', 'sim', true],
      ['2', 'time_trial', false],
      ['1', 'career', false],
    ])
    expect(all[2]!.career).toEqual({ id: career, name: 'Papaya', season: 1 })
    expect(listSessions(db, { program: 'time_trial' }).map((s) => s.car)).toEqual(['Ferrari'])
    expect(listSessions(db, { careerId: career }).map((s) => s.uid)).toEqual(['1'])
    expect(listSessions(db, { car: 'Ferrari' }).map((s) => s.uid)).toEqual(['2'])
    expect(listSessions(db, { before: '2026-11-03T00:00:00.000Z', limit: 1 })[0]!.uid).toBe('2')
  })

  it('opens a session with laps, stints and undone incidents', () => {
    const d = sessionDetail(db, '3')!
    expect(d.laps).toHaveLength(5)
    expect(d.laps[1]!.valid).toBe(false)
    expect(d.stints.map((s) => [s.fromLap, s.toLap, s.tyre])).toEqual([
      [1, 3, 'Soft'],
      [4, 5, 'Medium'],
    ])
    expect(d.stints[0]!.avgLapMs).toBe(80750)
    expect(d.stints[0]!.wearPerLapPct).toBe(2)
    expect(d.incidents).toEqual([
      { lap: 2, kind: 'warning', detail: 'corner cutting', sessionTime: 150, undone: true },
    ])
    expect(sessionDetail(db, 'nope')).toBeNull()
  })
})
