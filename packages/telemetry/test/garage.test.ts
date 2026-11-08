import { describe, expect, it } from 'vitest'
import { type RaceSnapshot, inGarage, isDriving } from '../src/state.ts'

const snap = (sessionType: string, driverStatus: number, status: RaceSnapshot['status'] = 'live') =>
  ({
    status,
    session: { sessionType },
    cars: [{ isPlayer: true, driverStatus }],
  }) as unknown as RaceSnapshot

describe('inGarage', () => {
  it('is the garage in practice when the player is parked', () => {
    expect(inGarage(snap('P1', 0))).toBe(true)
    expect(isDriving(snap('P1', 0))).toBe(false)
    expect(isDriving(snap('P1', 1))).toBe(true)
  })
  it('never counts in a race or when not live', () => {
    expect(inGarage(snap('Race', 0))).toBe(false)
    expect(inGarage(snap('P1', 0, 'paused'))).toBe(false)
  })
})
