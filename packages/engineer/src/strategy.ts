import type { stintModel } from '@gp/history'
import { type RaceSnapshot, VISUAL_COMPOUNDS, sessionKind } from '@gp/telemetry'

export type PracticeModel = ReturnType<typeof stintModel>

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
export function strategyView(
  s: RaceSnapshot,
  plan: PitPlan,
  practice: PracticeModel | null = null,
) {
  const me = s.cars.find((c) => c.isPlayer)
  const sess = s.session
  if (!me || !sess) return { available: false }
  const kind = sessionKind(sess.sessionType)
  if (kind !== 'race') {
    const known = new Set(
      practice?.compounds.filter((c) => c.wearPerLapPct !== null).map((c) => c.compound),
    )
    const missing = ['Soft', 'Medium', 'Hard'].filter((c) => !known.has(c))
    return {
      available: false,
      session: kind,
      practiceData: practice,
      ...(kind === 'practice'
        ? {
            runPlan: missing.length
              ? `No long-run data yet on: ${missing.join(', ')}. A run of 5+ laps on each race compound gives wear, pace drop and fuel use for the race plan.`
              : 'Long-run data on all three dry compounds: the race plan can be built from it.',
          }
        : {}),
      note: 'Pit strategy is for races; this is the data it will use.',
    }
  }
  const total = sess.totalLaps
  const lap = me.currentLap
  const lapsLeft = Math.max(0, total - lap + 1)
  const wear = s.player ? Math.max(...s.player.tyreWear) : null
  const age = me.tyreAgeLaps ?? 0
  const fromPractice =
    practice?.compounds.find((c) => c.compound === me.tyreVisual)?.wearPerLapPct ?? null
  // This stint's own rate once there are a few laps; practice before that.
  const ratePerLap = wear !== null && age >= 3 ? Math.round((wear / age) * 10) / 10 : fromPractice
  const lapsToLimit =
    wear !== null && ratePerLap ? Math.max(0, Math.floor((WEAR_LIMIT - wear) / ratePerLap)) : null
  const used = new Set(
    [...me.stints.map((x) => x.compound), me.tyreVisual].filter((c): c is string => !!c),
  )
  const dryUsed = [...used].filter((c) => DRY.has(c))
  const needsSecondCompound = !sess.weather?.includes('rain') && dryUsed.length < 2
  const sets = (s.player?.tyreSets?.sets ?? [])
    .filter((t) => t.available && !t.fitted)
    .map((t) => {
      const compound = VISUAL_COMPOUNDS[t.visualTyreCompound] ?? `#${t.visualTyreCompound}`
      const p = practice?.compounds.find((c) => c.compound === compound)
      // His own wear rate from practice beats the game's generic usable life.
      const own = p?.lapsTo70PctWear ? Math.floor(p.lapsTo70PctWear * (1 - t.wear / 100)) : null
      return {
        compound,
        wearPct: t.wear,
        usableLifeLaps: own ?? t.usableLife,
        lifeFrom: own !== null ? 'his practice wear' : 'game estimate',
        lapDeltaMsVsFitted: t.lapDeltaTime,
        paceLossPerLapMs: p?.paceLossPerLapMs ?? null,
      }
    })

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
    fuel:
      practice?.fuelPerLapKg && s.player
        ? {
            perLapKgFromPractice: practice.fuelPerLapKg,
            inTankKg: Math.round(s.player.fuelKg * 10) / 10,
            lapsOfFuel: Math.round((s.player.fuelKg / practice.fuelPerLapKg) * 10) / 10,
          }
        : null,
    practiceData: practice,
    compoundsUsed: [...used],
    mustUseAnotherDryCompound: needsSecondCompound,
    setsAvailable: sets,
    suggestion,
    agreedPlan: plan.view(),
    note: `Wear limit ${WEAR_LIMIT}% on the worst tyre. Wear rate is the average this stint, so early in a stint it's rough.`,
  }
}
