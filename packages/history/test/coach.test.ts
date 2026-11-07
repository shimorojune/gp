import type { CarSetup } from '@gp/telemetry'
import { describe, expect, it } from 'vitest'
import { type LapTrace, compareTraces, findCorners, setupDiff } from '../src/index.ts'

/** A straight, one corner at 1000 m (min `minKph`), braking from `brakeAt`, another straight. */
function trace(minKph: number, brakeAt: number): LapTrace {
  const t: LapTrace = { lap: 1, binM: 20, speed: [], throttle: [], brake: [], gear: [] }
  for (let m = 0; m < 2000; m += 20) {
    let v = 300
    if (m >= brakeAt && m <= 1000) v = 300 - ((300 - minKph) * (m - brakeAt)) / (1000 - brakeAt)
    else if (m > 1000 && m < 1300) v = minKph + ((300 - minKph) * (m - 1000)) / 300
    t.speed.push(Math.round(v))
    t.brake.push(m >= brakeAt && m < 1000 ? 100 : 0)
    t.throttle.push(m >= brakeAt && m < 1060 ? 0 : 100)
    t.gear.push(v > 200 ? 8 : 4)
  }
  return t
}

describe('corner comparison', () => {
  it('finds the corner and says he brakes early and carries less speed', () => {
    const pb = trace(120, 880)
    const lap = trace(110, 840)
    const corners = findCorners(pb)
    expect(corners).toHaveLength(1)
    expect(Math.abs(corners[0]! * 20 - 1000)).toBeLessThanOrEqual(20)
    const [c] = compareTraces(pb, lap)
    expect(c?.minKph).toBe(110)
    expect(c?.refMinKph).toBe(120)
    expect(c?.brakeLaterM).toBe(-40)
    expect(c?.timeMs).toBeGreaterThan(0)
  })
})

describe('setupDiff', () => {
  it('lists changed fields, ignoring fuel', () => {
    const a = { frontWing: 5, rearWing: 7, fuelLoad: 10 } as CarSetup
    const b = { frontWing: 6, rearWing: 7, fuelLoad: 30 } as CarSetup
    expect(setupDiff(a, b)).toEqual(['front wing 5 -> 6'])
  })
})
