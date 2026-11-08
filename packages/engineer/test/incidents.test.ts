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
    // 300 -> 220 kph in 400 ms is a big stop, still braking.
    for (let t = 0, v = 300; t <= 400; t += 100, v -= 20)
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
