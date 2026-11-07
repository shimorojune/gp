import { describe, expect, it } from 'vitest'
import { HEADER_SIZE, PacketId } from '../src/constants.ts'
import { type Packet, parsePacket } from '../src/parse.ts'
import { RaceState } from '../src/state.ts'
import { buildPacket, writeLap } from './build.ts'

function parsed(buf: Buffer): Packet {
  const res = parsePacket(buf)
  if (!res.ok) throw new Error(res.reason)
  return res.packet
}

describe('RaceState', () => {
  it('emits a completed lap with sectors when the lap number ticks over', () => {
    let clock = 0
    const state = new RaceState({ now: () => clock })
    const laps: number[] = []
    let s3 = 0
    state.on('lapCompleted', (l) => {
      if (l.isPlayer) {
        laps.push(l.lapTimeMs)
        s3 = l.sector3Ms
      }
    })

    const a = buildPacket(PacketId.LapData)
    writeLap(a, 0, { lapNum: 1, position: 1, s1Ms: 28000, s2Ms: 30000, currentLapMs: 80000 })
    state.ingest(parsed(a))

    clock = 100
    const b = buildPacket(PacketId.LapData)
    writeLap(b, 0, { lapNum: 2, position: 1, lastLapMs: 83456, currentLapMs: 100 })
    state.ingest(parsed(b))

    expect(laps).toEqual([83456])
    expect(s3).toBe(83456 - 28000 - 30000)
    expect(state.snapshot().player).toBeNull() // no telemetry/status yet
    expect(state.snapshot().cars[0]?.bestLapMs).toBe(83456)
  })

  it('does not count invalid laps as best', () => {
    const state = new RaceState({ now: () => 0 })
    const a = buildPacket(PacketId.LapData)
    writeLap(a, 0, { lapNum: 1, position: 1, invalid: true })
    state.ingest(parsed(a))
    const b = buildPacket(PacketId.LapData)
    writeLap(b, 0, { lapNum: 2, position: 1, lastLapMs: 70000 })
    state.ingest(parsed(b))
    expect(state.snapshot().cars[0]?.bestLapMs).toBe(0)
  })

  it('goes live, then paused when only events arrive, then no-data', () => {
    let clock = 0
    const state = new RaceState({ now: () => clock })
    const seen: string[] = []
    state.on('status', (s) => seen.push(s))

    state.ingest(parsed(buildPacket(PacketId.Session)))
    state.ingest(parsed(buildPacket(PacketId.CarTelemetry)))
    expect(state.tick()).toBe('live')

    clock = 2000
    const ev = buildPacket(PacketId.Event)
    ev.write('BUTN', HEADER_SIZE, 'latin1')
    state.ingest(parsed(ev))
    expect(state.tick()).toBe('paused')

    clock = 20_000
    expect(state.tick()).toBe('no-data')
    // Session alone (no driving packets yet) reads as paused.
    expect(seen).toEqual(['paused', 'live', 'paused', 'no-data'])
  })

  it('resets when the sessionUID changes', () => {
    const state = new RaceState({ now: () => 0 })
    const starts: string[] = []
    state.on('sessionStarted', (s) => starts.push(s.uid))
    state.ingest(parsed(buildPacket(PacketId.Session, { sessionUID: 1n })))
    state.ingest(parsed(buildPacket(PacketId.Session, { sessionUID: 1n })))
    state.ingest(parsed(buildPacket(PacketId.Session, { sessionUID: 2n })))
    expect(starts).toEqual(['1', '2'])
  })

  it('builds a session snapshot with track names and pit window', () => {
    const state = new RaceState({ now: () => 0 })
    const buf = buildPacket(PacketId.Session)
    const body = HEADER_SIZE
    buf.writeUInt8(10, body + 6) // sessionType Race
    buf.writeInt8(11, body + 7) // Monza
    // pitStopWindowIdealLap sits after marshal zones (21*5) + sc + net + nForecast + 56*8 + 2 + 12
    const pitIdeal = body + 19 + 21 * 5 + 3 + 56 * 8 + 2 + 12
    buf.writeUInt8(18, pitIdeal)
    buf.writeUInt8(24, pitIdeal + 1)
    state.ingest(parsed(buf))
    const s = state.snapshot().session!
    expect(s.track).toBe('Monza')
    expect(s.sessionType).toBe('Race')
    expect(s.pitWindowIdealLap).toBe(18)
    expect(s.pitWindowLatestLap).toBe(24)
  })
})
