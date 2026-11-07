import type { PacketId } from './constants.ts'
import type { Reader } from './reader.ts'

export interface PacketHeader {
  packetFormat: number
  gameYear: number
  gameMajorVersion: number
  gameMinorVersion: number
  packetVersion: number
  packetId: PacketId
  sessionUID: bigint
  sessionTime: number
  frameIdentifier: number
  overallFrameIdentifier: number
  playerCarIndex: number
  /** 255 when there is no second player. */
  secondaryPlayerCarIndex: number
}

export function readHeader(r: Reader): PacketHeader {
  return {
    packetFormat: r.u16(),
    gameYear: r.u8(),
    gameMajorVersion: r.u8(),
    gameMinorVersion: r.u8(),
    packetVersion: r.u8(),
    packetId: r.u8(),
    sessionUID: r.u64(),
    sessionTime: r.f32(),
    frameIdentifier: r.u32(),
    overallFrameIdentifier: r.u32(),
    playerCarIndex: r.u8(),
    secondaryPlayerCarIndex: r.u8(),
  }
}
