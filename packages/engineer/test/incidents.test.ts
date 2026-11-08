import { describe, expect, it } from 'vitest'
import { IncidentDetector } from '../src/incidents.ts'

const dmg = (frontLeftWing = 0) => ({
  frontLeftWing,
  frontRightWing: 0,
  rearWing: 0,
  floor: 0,
  diffuser: 0,
  sidepod: 0,
})

describe('IncidentDetector', () => {
  it('calls a spin when the car points away from its travel at speed', () => {
    const d = new IncidentDetector()
    const out: string[] = []
    // 20 m/s mostly sideways for 300 ms.
    for (let t = 0; t <= 300; t += 100)
      out.push(...d.update({ t, speedKph: 72, localVx: 18, localVz: 5, damage: dmg() }))
    expect(out).toEqual(['He spun at 67 kph.'])
  })
  it('ignores normal driving and hard braking', () => {
    const d = new IncidentDetector()
    const out: string[] = []
    // 300 -> 240 kph in 400 ms: harder than the hardest braking seen (51 kph).
    for (let t = 0, v = 300; t <= 400; t += 100, v -= 15)
      out.push(...d.update({ t, speedKph: v, localVx: 0.5, localVz: v / 3.6, damage: dmg() }))
    expect(out).toEqual([])
  })
  it('calls a wall hit with the new damage', () => {
    const d = new IncidentDetector()
    d.update({ t: 0, speedKph: 200, localVx: 0, localVz: 55, damage: dmg() })
    const out = d.update({ t: 200, speedKph: 40, localVx: 0, localVz: 11, damage: dmg(35) })
    expect(out[0]).toMatch(/hit something hard.*200 to 40 kph.*front wing \(left\) 35%/)
  })
  it('names the other car after a collision event', () => {
    const d = new IncidentDetector()
    d.update({ t: 0, speedKph: 150, localVx: 0, localVz: 42, damage: dmg() })
    d.contact(50, 'NORRIS')
    const out = d.update({ t: 100, speedKph: 150, localVx: 0, localVz: 42, damage: dmg(12) })
    expect(out[0]).toMatch(/Contact with NORRIS.*front wing \(left\) 12%/)
  })
})

describe('IncidentDetector patterns', () => {
  it('names the spot, the inputs before it, and repeats there', () => {
    const d = new IncidentDetector((m) => (Math.abs(m - 1200) < 250 ? 'corner 4' : null))
    const spin = (t0: number) => {
      const out: string[] = []
      out.push(
        ...d.update({
          t: t0,
          speedKph: 90,
          localVx: 0,
          localVz: 25,
          damage: dmg(),
          lapDistanceM: 1180,
          throttle: 1,
          brake: 0,
          gear: 3,
        }),
      )
      for (let t = t0 + 100; t <= t0 + 400; t += 100)
        out.push(
          ...d.update({
            t,
            speedKph: 72,
            localVx: 18,
            localVz: 5,
            damage: dmg(),
            lapDistanceM: 1200,
            throttle: 1,
            brake: 0,
            gear: 3,
          }),
        )
      return out
    }
    const first = spin(0)
    expect(first[0]).toMatch(
      /corner 4, 1180 m into the lap\. The slide began at 72 kph on 100% throttle, 0% brake; then throttle 100%, brake 0%, gear 3\./,
    )
    expect(first[0]).not.toMatch(/pattern/)
    const second = spin(90_000)
    expect(second[0]).toMatch(/Second incident at this spot this session: a pattern/)
  })
})

describe('IncidentDetector edge cases', () => {
  it('ignores a flashback teleport', () => {
    const d = new IncidentDetector()
    d.update({ t: 0, speedKph: 209, localVx: 0, localVz: 58, damage: dmg(), lapDistanceM: 3792 })
    const out = d.update({
      t: 100,
      speedKph: 77,
      localVx: 0,
      localVz: 21,
      damage: dmg(),
      lapDistanceM: 253,
    })
    expect(out).toEqual([])
  })
  const stopRun = (sideways: boolean) => {
    const d = new IncidentDetector()
    const out: string[] = []
    for (let t = 0, v = 60; t <= 1200; t += 100, v = Math.max(0, v - 6))
      out.push(
        ...d.update({
          t,
          speedKph: v,
          // A slide (35 deg) or a straight, deliberate stop.
          localVx: sideways ? (v / 3.6) * 0.7 : 0,
          localVz: v / 3.6,
          damage: dmg(),
          lapDistanceM: 1000 + t / 100,
          onLap: true,
        }),
      )
    return out
  }
  it('calls a stop on track after a slide', () => {
    expect(stopRun(true).some((l) => /stopped on track/.test(l))).toBe(true)
  })
  it('ignores a deliberate stop', () => {
    expect(stopRun(false)).toEqual([])
  })
})
