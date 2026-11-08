import { type RaceSnapshot, VISUAL_COMPOUNDS, sessionKind } from '@gp/telemetry'

/** The pit plan agreed with the driver. The radio calls "box" from it; tools change it. */
export class PitPlan {
  lap: number | null = null
  compound: string | null = null
  reason: string | null = null
  /** The lap we already called him in on, so it's said once. */
  calledLap: number | null = null

  set(lap: number, compound: string | null, reason: string | null): void {
    this.lap = lap
    this.compound = compound
    this.reason = reason
    this.calledLap = null
  }

  clear(): void {
    this.lap = null
    this.compound = null
    this.reason = null
    this.calledLap = null
  }

  view() {
    return this.lap === null
      ? null
      : { boxOnLap: this.lap, compound: this.compound, reason: this.reason }
  }
}

/** Wear (max of four corners, %) at which a tyre is past its useful life. */
const WEAR_LIMIT = 70
const DRY = new Set(['Soft', 'Medium', 'Hard'])

/**
 * The numbers a pit strategy needs, and a suggested plan from them. The engineer still
 * decides with the driver and records the agreed plan with set_pit_plan.
 */
export function strategyView(s: RaceSnapshot, plan: PitPlan) {
  const me = s.cars.find((c) => c.isPlayer)
  const sess = s.session
  if (!me || !sess) return { available: false }
  if (sessionKind(sess.sessionType) !== 'race')
    return {
      available: false,
      note: 'Pit strategy is for races. In practice, plan runs; in qualifying, plan tyre sets.',
    }
  const total = sess.totalLaps
  const lap = me.currentLap
  const lapsLeft = Math.max(0, total - lap + 1)
  const wear = s.player ? Math.max(...s.player.tyreWear) : null
  const age = me.tyreAgeLaps ?? 0
  const ratePerLap = wear !== null && age >= 2 ? Math.round((wear / age) * 10) / 10 : null
  const lapsToLimit =
    wear !== null && ratePerLap ? Math.max(0, Math.floor((WEAR_LIMIT - wear) / ratePerLap)) : null
  const used = new Set(
    [...me.stints.map((x) => x.compound), me.tyreVisual].filter((c): c is string => !!c),
  )
  const dryUsed = [...used].filter((c) => DRY.has(c))
  const needsSecondCompound = !sess.weather?.includes('rain') && dryUsed.length < 2
  const sets = (s.player?.tyreSets?.sets ?? [])
    .filter((t) => t.available && !t.fitted)
    .map((t) => ({
      compound: VISUAL_COMPOUNDS[t.visualTyreCompound] ?? `#${t.visualTyreCompound}`,
      wearPct: t.wear,
      usableLifeLaps: t.usableLife,
      lapDeltaMsVsFitted: t.lapDeltaTime,
    }))

  // Suggestion: stop when the tyres run out (or at the game's ideal lap, if earlier), onto
  // the quickest set that lasts to the flag; a new compound if the rules still need one.
  let suggestion: Record<string, unknown>
  const canFinish = lapsToLimit !== null && lapsToLimit >= lapsLeft
  if (canFinish && !needsSecondCompound) {
    suggestion = { stops: 0, why: 'Tyres last to the flag and the compound rule is met.' }
  } else {
    const byWear = lapsToLimit !== null ? lap + lapsToLimit : null
    const ideal = sess.pitWindowIdealLap > lap ? sess.pitWindowIdealLap : null
    const pitLap = Math.min(...[byWear, ideal, total - 1].filter((x): x is number => x !== null))
    const after = total - pitLap
    const fits = sets
      .filter((t) => t.usableLifeLaps >= after)
      .filter((t) => !needsSecondCompound || !dryUsed.includes(t.compound))
      .sort((a, b) => a.lapDeltaMsVsFitted - b.lapDeltaMsVsFitted)
    suggestion = fits[0]
      ? {
          stops: 1,
          boxOnLap: pitLap,
          compound: fits[0].compound,
          why: `${byWear === pitLap ? 'Tyres hit the wear limit' : "The game's ideal window"} around lap ${pitLap}; ${fits[0].compound} lasts the last ${after} laps.`,
        }
      : {
          stops: 2,
          firstStopLap: pitLap,
          why: `No single set lasts the ${after} laps after lap ${pitLap}: two stops, or manage the tyres.`,
        }
  }
  return {
    lap,
    totalLaps: total,
    lapsLeft,
    fitted: {
      compound: me.tyreVisual,
      ageLaps: age,
      maxWearPct: wear === null ? null : Math.round(wear),
      wearPerLapPct: ratePerLap,
      lapsUntilWorn: lapsToLimit,
    },
    gamePitWindow: sess.pitWindowIdealLap
      ? { idealLap: sess.pitWindowIdealLap, latestLap: sess.pitWindowLatestLap }
      : null,
    compoundsUsed: [...used],
    mustUseAnotherDryCompound: needsSecondCompound,
    setsAvailable: sets,
    suggestion,
    agreedPlan: plan.view(),
    note: `Wear limit ${WEAR_LIMIT}% on the worst tyre. Wear rate is the average this stint, so early in a stint it's rough.`,
  }
}
