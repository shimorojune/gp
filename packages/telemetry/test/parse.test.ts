import { describe, expect, it } from 'vitest'
import { HEADER_SIZE, PACKET_SIZES, PacketId } from '../src/constants.ts'
import { readHeader } from '../src/header.ts'
import * as p from '../src/packets.ts'
import { parsePacket } from '../src/parse.ts'
import { Reader } from '../src/reader.ts'
import { buildPacket, writeLap } from './build.ts'

const structReaders: [PacketId, (r: Reader) => unknown][] = [
  [PacketId.Motion, p.readMotion],
  [PacketId.Session, p.readSession],
  [PacketId.LapData, p.readLapDataPacket],
  [PacketId.Participants, p.readParticipants],
  [PacketId.CarSetups, p.readCarSetups],
  [PacketId.CarTelemetry, p.readCarTelemetryPacket],
  [PacketId.CarStatus, p.readCarStatusPacket],
  [PacketId.FinalClassification, p.readFinalClassificationPacket],
  [PacketId.CarDamage, p.readCarDamagePacket],
  [PacketId.SessionHistory, p.readSessionHistory],
  [PacketId.TyreSets, p.readTyreSets],
  [PacketId.MotionEx, p.readMotionEx],
]

describe('struct layouts', () => {
  it('header is 29 bytes', () => {
    const r = new Reader(buildPacket(PacketId.Motion))
    readHeader(r)
    expect(r.offset).toBe(HEADER_SIZE)
  })

  // The strongest check we have without a spec PDF in CI: every reader must consume
  // exactly the packet size the game sends (sizes confirmed against live F1 23 traffic).
  it.each(structReaders)('packet %i consumes exactly its spec size', (id, read) => {
    const buf = buildPacket(id)
    const r = new Reader(buf)
    readHeader(r)
    read(r)
    expect(r.offset).toBe(PACKET_SIZES[id])
  })

  it('event details fit in the 12-byte union', () => {
    for (const code of ['FTLP', 'PENA', 'SPTP', 'FLBK', 'BUTN', 'OVTK', 'STLG', 'SSTA']) {
      const buf = buildPacket(PacketId.Event)
      buf.write(code, HEADER_SIZE, 'latin1')
      const r = new Reader(buf)
      readHeader(r)
      p.readEvent(r)
      expect(r.offset).toBeLessThanOrEqual(PACKET_SIZES[PacketId.Event])
    }
  })
})

describe('parsePacket', () => {
  it('decodes header fields', () => {
    const res = parsePacket(
      buildPacket(PacketId.CarTelemetry, { sessionUID: 99n, sessionTime: 12.5 }),
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.packet.header.gameYear).toBe(23)
    expect(res.packet.header.sessionUID).toBe(99n)
    expect(res.packet.header.sessionTime).toBe(12.5)
    expect(res.packet.header.secondaryPlayerCarIndex).toBe(255)
  })

  it('decodes lap data values at the right offsets', () => {
    const buf = buildPacket(PacketId.LapData)
    writeLap(buf, 3, { lastLapMs: 83456, s1Ms: 28000, s2Ms: 30000, position: 5, lapNum: 7 })
    const res = parsePacket(buf)
    if (!res.ok || res.packet.id !== PacketId.LapData) throw new Error('bad parse')
    const car = res.packet.data.cars[3]!
    expect(car.lastLapTimeInMS).toBe(83456)
    expect(car.sector1TimeInMS).toBe(28000)
    expect(car.sector2TimeInMS).toBe(30000)
    expect(car.carPosition).toBe(5)
    expect(car.currentLapNum).toBe(7)
    expect(car.resultStatus).toBe(2)
  })

  it('decodes event codes', () => {
    const buf = buildPacket(PacketId.Event)
    buf.write('FTLP', HEADER_SIZE, 'latin1')
    buf.writeUInt8(4, HEADER_SIZE + 4)
    buf.writeFloatLE(81.25, HEADER_SIZE + 5)
    const res = parsePacket(buf)
    if (!res.ok || res.packet.id !== PacketId.Event) throw new Error('bad parse')
    expect(res.packet.data.details).toEqual({ code: 'FTLP', vehicleIdx: 4, lapTime: 81.25 })
  })

  it('decodes participant names', () => {
    const buf = buildPacket(PacketId.Participants)
    // numActiveCars @29, participant 0 starts @30, name @30+7
    buf.write('VERSTAPPEN', 30 + 7, 'utf8')
    const res = parsePacket(buf)
    if (!res.ok || res.packet.id !== PacketId.Participants) throw new Error('bad parse')
    expect(res.packet.data.participants[0]!.name).toBe('VERSTAPPEN')
  })

  it('rejects junk without throwing', () => {
    expect(parsePacket(Buffer.alloc(5))).toMatchObject({ ok: false, reason: 'too-short' })
    const wrongFormat = buildPacket(PacketId.Motion)
    wrongFormat.writeUInt16LE(2020, 0)
    expect(parsePacket(wrongFormat)).toMatchObject({ ok: false, reason: 'wrong-format' })
    const truncated = buildPacket(PacketId.Motion).subarray(0, 600)
    expect(parsePacket(truncated)).toMatchObject({ ok: false, reason: 'wrong-size' })
    expect(parsePacket(buildPacket(PacketId.LobbyInfo))).toMatchObject({
      ok: false,
      reason: 'ignored',
    })
  })
})
