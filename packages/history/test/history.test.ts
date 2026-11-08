import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Packet, PacketId, parsePacket } from '@gp/telemetry'
import { describe, expect, it } from 'vitest'
import { buildPacket, writeLap } from '../../telemetry/test/build.ts'
import {
  HistoryDb,
  type LapRecord,
  SessionCollector,
  lapStats,
  pruneRecordings,
} from '../src/index.ts'

const lap = (n: number, ms: number, valid = true): LapRecord => ({
  lap: n,
  lapMs: ms,
  s1Ms: Math.round(ms * 0.3),
  s2Ms: Math.round(ms * 0.4),
  s3Ms: ms - Math.round(ms * 0.3) - Math.round(ms * 0.4),
  valid,
  tyre: 'Soft',
  tyreAge: n,
  fuelKg: 10,
  position: 3,
  setupKey: null,
  flashback: false,
})

function parsed(buf: Buffer): Packet {
  const r = parsePacket(buf)
  if (!r.ok) throw new Error(r.reason)
  return r.packet
}

describe('lapStats', () => {
  it('ignores invalid laps and slow in/out laps for pace and consistency', () => {
    const s = lapStats([
      lap(1, 90000),
      lap(2, 72000),
      lap(3, 71000, false),
      lap(4, 72400),
      lap(5, 72200),
    ])
    expect(s.validLaps).toBe(4)
    expect(s.bestLapMs).toBe(72000)
    expect(s.medianLapMs).toBe(72200)
    expect(s.consistencyMs).toBeGreaterThan(0)
    expect(s.consistencyMs).toBeLessThan(500)
  })
})

describe('SessionCollector', () => {
  it('turns lap ticks into a session record with sim/career program', () => {
    const c = new SessionCollector(0)
    const session = buildPacket(PacketId.Session)
    c.feed(parsed(session), 0)
    const a = buildPacket(PacketId.LapData)
    writeLap(a, 0, { lapNum: 1, position: 2, s1Ms: 20000, s2Ms: 30000 })
    c.feed(parsed(a), 10)
    const b = buildPacket(PacketId.LapData)
    writeLap(b, 0, { lapNum: 2, position: 2, lastLapMs: 75000 })
    c.feed(parsed(b), 20)
    const [rec] = c.finish()
    expect(rec?.laps).toHaveLength(1)
    expect(rec?.laps[0]?.lapMs).toBe(75000)
    expect(rec?.program).toBe('sim')
  })

  it('drops sessions with nothing driven', () => {
    const c = new SessionCollector(0)
    c.feed(parsed(buildPacket(PacketId.Session)), 0)
    expect(c.finish()).toEqual([])
  })
})

describe('HistoryDb', () => {
  const record = (uid: string, laps: LapRecord[]) => {
    const c = new SessionCollector(0)
    c.feed(parsed(buildPacket(PacketId.Session, { sessionUID: BigInt(uid) })), 0)
    const a = buildPacket(PacketId.LapData, { sessionUID: BigInt(uid) })
    writeLap(a, 0, { lapNum: 1, position: 1 })
    c.feed(parsed(a), 1)
    const b = buildPacket(PacketId.LapData, { sessionUID: BigInt(uid) })
    writeLap(b, 0, { lapNum: 2, position: 1, lastLapMs: 80000 })
    c.feed(parsed(b), 2)
    return { ...c.finish()[0]!, laps }
  }

  it('stores a session once, keeping the copy with more laps', () => {
    const db = new HistoryDb(':memory:')
    const id1 = db.saveSession(record('7', [lap(1, 80000)]), 'a.gprec')
    const id2 = db.saveSession(record('7', [lap(1, 80000)]), 'b.gprec')
    expect(id2).toBe(id1)
    db.saveSession(record('7', [lap(1, 80000), lap(2, 79000)]), 'b.gprec')
    const rows = db.recentSessions()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.laps_done).toBe(2)
    expect(rows[0]?.best_lap_ms).toBe(79000)
    expect(db.sessionLaps(rows[0]!.id)).toHaveLength(2)
  })

  it('reports a session only once when two recordings hold it', async () => {
    const db = new HistoryDb(':memory:')
    const r = record('9', [lap(1, 80000)])
    const before = db.sessionVersion('9')
    db.saveSession(r, 'a.gprec')
    expect(db.sessionVersion('9')).not.toBe(before)
    const again = db.sessionVersion('9')
    db.saveSession(r, 'b.gprec')
    expect(db.sessionVersion('9')).toBe(again)
  })

  it('prunes only old recordings that were ingested', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-hist-'))
    const db = new HistoryDb(':memory:')
    for (const n of ['1', '2', '3', '4']) writeFileSync(join(dir, `${n}.gprec`), 'x')
    db.markRecording('1.gprec', 1, 0, null)
    db.markRecording('2.gprec', 1, 0, 'broken')
    db.markRecording('3.gprec', 1, 0, null)
    expect(pruneRecordings(db, dir, 1)).toEqual(['1.gprec', '3.gprec'])
    expect(readdirSync(dir).sort()).toEqual(['2.gprec', '4.gprec'])
  })
})
