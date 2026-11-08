import type { RaceSnapshot } from '@gp/telemetry'
import { describe, expect, it } from 'vitest'
import { PitPlan, strategyView } from '../src/strategy.ts'

const set = (visual: number, usableLife: number, extra: Record<string, number> = {}) => ({
  actualTyreCompound: 0,
  visualTyreCompound: visual,
  wear: 0,
  available: 1,
  recommendedSession: 0,
  lifeSpan: usableLife,
  usableLife,
  lapDeltaTime: 0,
  fitted: 0,
  ...extra,
})

const snap = (lap: number, wear: number, age: number): RaceSnapshot =>
  ({
    status: 'live',
    session: {
      sessionType: 'Race',
      totalLaps: 30,
      weather: 'Clear',
      pitWindowIdealLap: 14,
      pitWindowLatestLap: 17,
    },
    player: {
      tyreWear: [wear, wear - 2, wear - 4, wear - 5],
      tyreSets: { sets: [set(16, 12, { fitted: 1 }), set(17, 22), set(18, 30)] },
    },
    cars: [{ isPlayer: true, currentLap: lap, tyreVisual: 'Soft', tyreAgeLaps: age, stints: [] }],
  }) as unknown as RaceSnapshot

describe('strategyView', () => {
  it('suggests one stop onto a different compound that lasts to the flag', () => {
    const v = strategyView(snap(6, 25, 5), new PitPlan()) as {
      fitted: { wearPerLapPct: number; lapsUntilWorn: number }
      mustUseAnotherDryCompound: boolean
      suggestion: unknown
    }
    expect(v.fitted.wearPerLapPct).toBe(5)
    expect(v.fitted.lapsUntilWorn).toBe(9)
    expect(v.mustUseAnotherDryCompound).toBe(true)
    // Worn by lap 15, the game's window says 14: box 14, 16 laps to go on mediums (22 laps).
    expect(v.suggestion).toMatchObject({ stops: 1, boxOnLap: 14, compound: 'Medium' })
  })
  it('only applies to races', () => {
    const s = snap(6, 25, 5)
    s.session!.sessionType = 'P1'
    expect(strategyView(s, new PitPlan())).toMatchObject({ available: false })
  })
})
