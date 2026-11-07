import { HEADER_SIZE, PACKET_FORMAT, PACKET_SIZES, PacketId } from './constants.ts'
import { type PacketHeader, readHeader } from './header.ts'
import * as p from './packets.ts'
import { Reader } from './reader.ts'

export type Packet =
  | { id: PacketId.Motion; header: PacketHeader; data: p.MotionData }
  | { id: PacketId.Session; header: PacketHeader; data: p.SessionData }
  | { id: PacketId.LapData; header: PacketHeader; data: p.LapDataPacket }
  | { id: PacketId.Event; header: PacketHeader; data: p.EventData }
  | { id: PacketId.Participants; header: PacketHeader; data: p.ParticipantsData }
  | { id: PacketId.CarSetups; header: PacketHeader; data: p.CarSetupsData }
  | { id: PacketId.CarTelemetry; header: PacketHeader; data: p.CarTelemetryData }
  | { id: PacketId.CarStatus; header: PacketHeader; data: p.CarStatusData }
  | { id: PacketId.FinalClassification; header: PacketHeader; data: p.FinalClassificationData }
  | { id: PacketId.CarDamage; header: PacketHeader; data: p.CarDamageData }
  | { id: PacketId.SessionHistory; header: PacketHeader; data: p.SessionHistoryData }
  | { id: PacketId.TyreSets; header: PacketHeader; data: p.TyreSetsData }
  | { id: PacketId.MotionEx; header: PacketHeader; data: p.MotionExData }

export type PacketOf<Id extends PacketId> = Extract<Packet, { id: Id }>

export type ParseResult =
  | { ok: true; packet: Packet }
  | {
      ok: false
      reason: 'too-short' | 'wrong-format' | 'wrong-size' | 'unknown-id' | 'ignored'
      detail?: string
    }

const readers: Partial<Record<PacketId, (r: Reader) => Packet['data']>> = {
  [PacketId.Motion]: p.readMotion,
  [PacketId.Session]: p.readSession,
  [PacketId.LapData]: p.readLapDataPacket,
  [PacketId.Event]: p.readEvent,
  [PacketId.Participants]: p.readParticipants,
  [PacketId.CarSetups]: p.readCarSetups,
  [PacketId.CarTelemetry]: p.readCarTelemetryPacket,
  [PacketId.CarStatus]: p.readCarStatusPacket,
  [PacketId.FinalClassification]: p.readFinalClassificationPacket,
  [PacketId.CarDamage]: p.readCarDamagePacket,
  [PacketId.SessionHistory]: p.readSessionHistory,
  [PacketId.TyreSets]: p.readTyreSets,
  [PacketId.MotionEx]: p.readMotionEx,
}

/**
 * Parse one UDP datagram from F1 23. Never throws on bad input: anything that isn't a
 * well-formed 2023 packet comes back as `{ ok: false }` so a stray datagram can't crash the app.
 */
export function parsePacket(buf: Buffer): ParseResult {
  if (buf.length < HEADER_SIZE) return { ok: false, reason: 'too-short' }
  const r = new Reader(buf)
  const header = readHeader(r)
  if (header.packetFormat !== PACKET_FORMAT) {
    return { ok: false, reason: 'wrong-format', detail: String(header.packetFormat) }
  }
  const id = header.packetId
  const expected = PACKET_SIZES[id as PacketId]
  if (expected === undefined) return { ok: false, reason: 'unknown-id', detail: String(id) }
  if (buf.length !== expected) {
    return { ok: false, reason: 'wrong-size', detail: `id ${id}: ${buf.length} != ${expected}` }
  }
  const read = readers[id]
  if (!read) return { ok: false, reason: 'ignored', detail: String(id) }
  return { ok: true, packet: { id, header, data: read(r) } as Packet }
}
