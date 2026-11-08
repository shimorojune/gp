import { formatLapTime } from '@gp/shared'
import type { CarSetup } from '@gp/telemetry'
import { cornerReport, setupDiff } from './coach.ts'
import type { LapRecord, LapTrace } from './collector.ts'

/** Rough F1 game fuel effect: each kg burned is worth about this much lap time. */
const MS_PER_KG = 30

export interface LiveSession {
  laps: LapRecord[]
  setups: Record<string, CarSetup>
  bestBySetup: Map<string, { ms: number; trace: LapTrace }>
}

interface Run {
  key: string
  laps: LapRecord[]
}

/** Laps worth comparing: valid, no flashback, not an in/out lap (within 107% of the best). */
function racing(laps: LapRecord[]): LapRecord[] {
  const ok = laps.filter((l) => l.valid && !l.flashback && l.lapMs > 0)
  const best = Math.min(...ok.map((l) => l.lapMs))
  return ok.filter((l) => l.lapMs <= best * 1.07)
}

function stats(laps: LapRecord[]) {
  const ms = laps.map((l) => l.lapMs).sort((a, b) => a - b)
  const min = (k: 's1Ms' | 's2Ms' | 's3Ms') =>
    Math.min(...laps.map((l) => l[k]).filter((x) => x > 0))
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  return {
    laps: laps.length,
    bestMs: ms[0] ?? null,
    medianMs: ms.length ? ms[Math.floor(ms.length / 2)]! : null,
    s1: laps.length ? min('s1Ms') : null,
    s2: laps.length ? min('s2Ms') : null,
    s3: laps.length ? min('s3Ms') : null,
    fuelKg: avg(laps.map((l) => l.fuelKg).filter((x): x is number => x !== null)),
    tyreAge: avg(laps.map((l) => l.tyreAge).filter((x): x is number => x !== null)),
    tyres: [...new Set(laps.map((l) => l.tyre).filter(Boolean))].join('/'),
  }
}

const sec = (ms: number | null) =>
  ms === null ? null : `${ms >= 0 ? '+' : ''}${(ms / 1000).toFixed(2)}s`

/**
 * "Is that better?": the setup he's on now against the one he ran before it, this session.
 * All the maths is here, so the engineer only has to read the verdict and the numbers out.
 * Negative deltas = the new setup is quicker.
 */
export function setupTrial(live: LiveSession) {
  const runs: Run[] = []
  for (const l of live.laps) {
    if (!l.setupKey) continue
    const last = runs.at(-1)
    if (last && last.key === l.setupKey) last.laps.push(l)
    else runs.push({ key: l.setupKey, laps: [l] })
  }
  const cur = runs.at(-1)
  if (!cur) return { verdict: 'no laps yet' }
  const prevRun = [...runs].reverse().find((r) => r.key !== cur.key)
  if (!prevRun) return { verdict: 'no setup change this session', lapsOnThisSetup: cur.laps.length }
  // Everything driven on the previous setup this session, not just its last run.
  const beforeLaps = racing(runs.filter((r) => r.key === prevRun.key).flatMap((r) => r.laps))
  const afterLaps = racing(cur.laps)
  const before = stats(beforeLaps)
  const after = stats(afterLaps)
  const prevSetup = live.setups[prevRun.key]
  const curSetup = live.setups[cur.key]
  const changes = prevSetup && curSetup ? setupDiff(prevSetup, curSetup) : []
  if (after.laps < 2 || before.laps < 1)
    return {
      verdict: 'too early',
      detail: `${after.laps} clean lap(s) on the new setup so far; need at least 2 to compare`,
      changes,
    }
  // Medians when both have 3+ clean laps (one good lap can be luck); otherwise best laps.
  const useMedian = before.laps >= 3 && after.laps >= 3
  const raw = useMedian ? after.medianMs! - before.medianMs! : after.bestMs! - before.bestMs!
  // Less fuel on board makes the later run look quicker than the setup really is.
  const fuelGainMs =
    before.fuelKg !== null && after.fuelKg !== null ? (before.fuelKg - after.fuelKg) * MS_PER_KG : 0
  const corrected = Math.round(raw + fuelGainMs)
  const threshold = useMedian ? 100 : 150
  const verdict =
    corrected <= -threshold ? 'better' : corrected >= threshold ? 'worse' : 'no clear difference'
  const confounders: string[] = []
  if (Math.abs(fuelGainMs) >= 50)
    confounders.push(
      `fuel ${Math.round(before.fuelKg! - after.fuelKg!)} kg lighter now, worth about ${sec(-fuelGainMs)} (already corrected)`,
    )
  if (before.tyres !== after.tyres)
    confounders.push(`different tyres (${before.tyres} vs ${after.tyres})`)
  if (
    before.tyreAge !== null &&
    after.tyreAge !== null &&
    Math.abs(after.tyreAge - before.tyreAge) >= 4
  )
    confounders.push(
      `tyres about ${Math.round(after.tyreAge - before.tyreAge)} laps older on the new setup`,
    )
  if (!useMedian) confounders.push('few laps: based on best laps only, low confidence')
  const tb = live.bestBySetup.get(prevRun.key)
  const ta = live.bestBySetup.get(cur.key)
  return {
    verdict,
    basis: useMedian ? 'typical (median) clean lap' : 'best clean lap',
    delta: sec(corrected),
    rawDelta: sec(raw),
    sectors: {
      s1: before.s1 && after.s1 ? sec(after.s1 - before.s1) : null,
      s2: before.s2 && after.s2 ? sec(after.s2 - before.s2) : null,
      s3: before.s3 && after.s3 ? sec(after.s3 - before.s3) : null,
    },
    before: {
      laps: before.laps,
      best: before.bestMs ? formatLapTime(before.bestMs) : null,
      typical: before.medianMs ? formatLapTime(before.medianMs) : null,
    },
    after: {
      laps: after.laps,
      best: after.bestMs ? formatLapTime(after.bestMs) : null,
      typical: after.medianMs ? formatLapTime(after.medianMs) : null,
    },
    changes,
    confounders,
    corners: tb && ta ? cornerReport(tb.trace, ta.trace, 'best lap on the previous setup') : null,
  }
}
