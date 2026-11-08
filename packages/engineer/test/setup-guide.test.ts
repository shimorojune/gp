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
  it('lists everything without a symptom', () => {
    expect((setupGuide() as { settings: unknown[] }).settings.length).toBeGreaterThan(10)
  })
})
