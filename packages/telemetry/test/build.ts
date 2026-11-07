import { HEADER_SIZE, PACKET_FORMAT, PACKET_SIZES, type PacketId } from '../src/constants.ts'

export interface HeaderOverrides {
  sessionUID?: bigint
  sessionTime?: number
  frame?: number
  playerCarIndex?: number
}

/** A zeroed packet of the right size with a valid 2023 header. */
export function buildPacket(id: PacketId, h: HeaderOverrides = {}): Buffer {
  const buf = Buffer.alloc(PACKET_SIZES[id])
  buf.writeUInt16LE(PACKET_FORMAT, 0)
  buf.writeUInt8(23, 2)
  buf.writeUInt8(1, 3)
  buf.writeUInt8(21, 4)
  buf.writeUInt8(1, 5)
  buf.writeUInt8(id, 6)
  buf.writeBigUInt64LE(h.sessionUID ?? 42n, 7)
  buf.writeFloatLE(h.sessionTime ?? 0, 15)
  buf.writeUInt32LE(h.frame ?? 0, 19)
  buf.writeUInt32LE(h.frame ?? 0, 23)
  buf.writeUInt8(h.playerCarIndex ?? 0, 27)
  buf.writeUInt8(255, 28)
  return buf
}

export const LAP_DATA_SIZE = 50

/** Write selected LapData fields for one car. Offsets follow the 2023 struct. */
export function writeLap(
  buf: Buffer,
  car: number,
  f: {
    lastLapMs?: number
    currentLapMs?: number
    s1Ms?: number
    s2Ms?: number
    position?: number
    lapNum?: number
    invalid?: boolean
    resultStatus?: number
  },
): void {
  const o = HEADER_SIZE + car * LAP_DATA_SIZE
  if (f.lastLapMs !== undefined) buf.writeUInt32LE(f.lastLapMs, o)
  if (f.currentLapMs !== undefined) buf.writeUInt32LE(f.currentLapMs, o + 4)
  if (f.s1Ms !== undefined) buf.writeUInt16LE(f.s1Ms, o + 8)
  if (f.s2Ms !== undefined) buf.writeUInt16LE(f.s2Ms, o + 11)
  if (f.position !== undefined) buf.writeUInt8(f.position, o + 30)
  if (f.lapNum !== undefined) buf.writeUInt8(f.lapNum, o + 31)
  if (f.invalid !== undefined) buf.writeUInt8(f.invalid ? 1 : 0, o + 35)
  buf.writeUInt8(f.resultStatus ?? 2, o + 43)
}
