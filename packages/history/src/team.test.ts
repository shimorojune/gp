import { describe, expect, it } from 'vitest'
import { expectedRange, rankTeams } from './team.ts'

describe('rankTeams', () => {
  it('ranks teams by their quicker car and ignores cars without a lap', () => {
    const r = rankTeams([
      { team: 'A', bestLapMs: 80_000 },
      { team: 'A', bestLapMs: 80_500 },
      { team: 'B', bestLapMs: 81_000 },
      { team: 'B', bestLapMs: 79_900 },
      { team: 'C', bestLapMs: 0 },
      { team: 'C', bestLapMs: 80_800 },
      { team: 'D', bestLapMs: 0 },
    ])
    expect(r.map((t) => t.team)).toEqual(['B', 'A', 'C'])
    expect(r[0]!.gapPct).toBe(0)
    expect(r[2]!.gapPct).toBe(1.1)
  })
})

describe('expectedRange', () => {
  it('maps a pace rank to the natural finishing range', () => {
    expect(expectedRange(1, 10)).toContain('P1-P2')
    expect(expectedRange(8, 10)).toContain('P15-P16')
  })
})
