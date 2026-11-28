import type { CarSetup } from '@gp/telemetry'
import { describe, expect, it } from 'vitest'
import {
  type LapTrace,
  compareTraces,
  deltaAt,
  findCorners,
  setupDiff,
  straightAheadS,
  traceTimes,
} from '../src/index.ts'

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

describe('lap time trace', () => {
  const withTimes = (t: LapTrace, offsetMs = 0): LapTrace => {
    // Times from the speed, as the collector would record them.
    const times: number[] = []
    let ms = offsetMs
    for (const kph of t.speed) {
      times.push(Math.round(ms))
      ms += (t.binM / (kph / 3.6)) * 1000
    }
    return { ...t, timeMs: times }
  }

  it('uses recorded times and fills gaps from the speed', () => {
    const t = withTimes(trace(120, 880))
    t.timeMs![10] = -1
    const times = traceTimes(t)
    expect(times[0]).toBe(0)
    expect(times[10]).toBeGreaterThan(times[9]!)
    expect(times[11]).toBe(t.timeMs![11])
    // Old traces without times still get an estimate.
    const { timeMs: _x, ...old } = t
    expect(traceTimes(old as LapTrace).at(-1)).toBeGreaterThan(0)
  })

  it('gives the live delta to the reference at a point of the lap', () => {
    const ref = withTimes(trace(120, 880))
    const at = traceTimes(ref)[50]!
    expect(deltaAt(ref, 1000, at + 250)).toBe(250)
    expect(deltaAt(ref, 1000, at - 100)).toBe(-100)
    expect(deltaAt(ref, 99_999, 1000)).toBeNull()
  })

  it('measures the straight left ahead from how the reference was driven', () => {
    const ref = trace(120, 880)
    // 300 kph from 0 m to the brakes at 880 m: ~10.5 s from the line, none in the corner.
    expect(straightAheadS(ref, 0)).toBeGreaterThan(10)
    expect(straightAheadS(ref, 800)).toBeLessThan(1.2)
    expect(straightAheadS(ref, 950)).toBe(0)
    // After the corner the straight runs across the line into the next lap's first straight.
    expect(straightAheadS(ref, 1900)).toBeGreaterThan(11)
  })

  it('compares corners on recorded times when both laps have them', () => {
    const pb = withTimes(trace(120, 880))
    const lap = withTimes(trace(110, 840))
    const [c] = compareTraces(pb, lap)
    expect(c?.timeMs).toBeGreaterThan(0)
  })
})
