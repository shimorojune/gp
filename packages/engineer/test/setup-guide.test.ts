import { describe, expect, it } from 'vitest'
import { setupGuide } from '../src/setup-guide.ts'

describe('setupGuide', () => {
  it('matches exit wheelspin to the traction fixes, diff first', () => {
    const g = setupGuide('getting wheelspin on exit of slow corners') as {
      matches: { symptom: string; changes: { change: string }[] }[]
    }
    expect(g.matches[0]?.symptom).toMatch(/Wheelspin/)
    expect(g.matches[0]?.changes[0]?.change).toMatch(/on throttle/)
  })
  it.each([
    'exit oversteer',
    'car is too oversteery on exits',
    'rear steps out on the throttle out of slow corners',
  ])('sends "%s" to the traction fixes', (q) => {
    const g = setupGuide(q) as { matches: { symptom: string }[] }
    expect(g.matches[0]?.symptom).toMatch(/Wheelspin/)
    expect(g.matches.some((m) => /Understeer/.test(m.symptom))).toBe(false)
  })
  it('keeps entry oversteer on the entry fixes', () => {
    const g = setupGuide('oversteer on turn in under braking') as { matches: { symptom: string }[] }
    expect(g.matches[0]?.symptom).toMatch(/Oversteer on entry/)
  })
  it('lists everything without a symptom', () => {
    expect((setupGuide() as { settings: unknown[] }).settings.length).toBeGreaterThan(10)
  })
})
