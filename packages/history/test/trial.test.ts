import type { CarSetup } from '@gp/telemetry'
import { describe, expect, it } from 'vitest'
import { type LapRecord, setupTrial } from '../src/index.ts'

const base = { frontWing: 25, rearWing: 27 } as CarSetup
const lap = (n: number, ms: number, key: string, fuelKg = 10): LapRecord => ({
  lap: n,
  lapMs: ms,
  s1Ms: 18000,
  s2Ms: ms - 18000 - 17500,
  s3Ms: 17500,
  valid: true,
  tyre: 'Soft',
  tyreAge: n,
  fuelKg,
  position: 1,
  setupKey: key,
  flashback: false,
})

describe('setupTrial', () => {
  const setups = { A: base, B: { ...base, frontWing: 27 } as CarSetup }
  it('says too early after one lap on the new setup', () => {
    const t = setupTrial({
      laps: [lap(1, 74000, 'A'), lap(2, 73500, 'A'), lap(3, 73300, 'B')],
      setups,
      bestBySetup: new Map(),
    })
    expect(t.verdict).toBe('too early')
  })
  it('calls a clear improvement better, listing the change', () => {
    const t = setupTrial({
      laps: [
        lap(1, 99000, 'A'),
        lap(2, 73600, 'A'),
        lap(3, 73500, 'A'),
        lap(4, 73700, 'A'),
        lap(5, 73100, 'B'),
        lap(6, 73200, 'B'),
        lap(7, 73150, 'B'),
      ],
      setups,
      bestBySetup: new Map(),
    }) as { verdict: string; changes: string[]; basis: string }
    expect(t.verdict).toBe('better')
    expect(t.basis).toContain('median')
    expect(t.changes).toEqual(['front wing 25 -> 27'])
  })
  it('does not credit the setup for burned fuel', () => {
    const t = setupTrial({
      laps: [
        lap(1, 73600, 'A', 60),
        lap(2, 73500, 'A', 58),
        lap(3, 73400, 'B', 20),
        lap(4, 73350, 'B', 18),
      ],
      setups,
      bestBySetup: new Map(),
    })
    expect(t.verdict).toBe('worse')
  })
})
