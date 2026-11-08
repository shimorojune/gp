/**
 * Compact, model-friendly views of the race state. Tool results are what the engineer
 * reasons over, so they carry formatted times and only the fields that matter. Keeping
 * them small keeps replies fast and the session's context lean over a long race.
 */
import { formatDelta, formatLapTime } from '@gp/shared'
import {
  ACTUAL_COMPOUNDS,
  type CarSnapshot,
  PIT_STATUS,
  type RaceSnapshot,
  TEAMS,
  VISUAL_COMPOUNDS,
  inGarage,
} from '@gp/telemetry'

const r1 = (n: number) => Math.round(n * 10) / 10
const wheels = (w: readonly number[], f: (n: number) => number | string = r1) => ({
  FL: f(w[2]!),
  FR: f(w[3]!),
  RL: f(w[0]!),
  RR: f(w[1]!),
})

/** resultStatus 4+ = DNF, DSQ, not classified, retired. */
const running = (c: CarSnapshot) => c.resultStatus <= 3

/** Nearest running cars ahead and behind the player (retired cars keep a position). */
function neighbours(s: RaceSnapshot, me: CarSnapshot | undefined) {
  if (!me) return { ahead: undefined, behind: undefined }
  const others = s.cars.filter((c) => !c.isPlayer && running(c))
  const ahead = others
    .filter((c) => c.position < me.position)
    .sort((a, b) => b.position - a.position)[0]
  const behind = others
    .filter((c) => c.position > me.position)
    .sort((a, b) => a.position - b.position)[0]
  return { ahead, behind }
}

export function situation(s: RaceSnapshot) {
  const me = s.cars.find((c) => c.isPlayer)
  const sess = s.session
  return {
    status: inGarage(s) ? 'garage' : s.status,
    track: sess?.track ?? null,
    session: sess?.sessionType ?? null,
    lap: me ? me.currentLap : null,
    totalLaps: sess?.totalLaps || null,
    position: me?.position ?? null,
    carsRunning: s.cars.length,
    safetyCar: sess?.safetyCar ?? null,
    weather: sess?.weather ?? null,
  }
}

export function raceSnapshotView(s: RaceSnapshot) {
  const me = s.cars.find((c) => c.isPlayer)
  const p = s.player
  const { ahead, behind } = neighbours(s, me)
  return {
    ...situation(s),
    // The game labels the driver's car with that seat's real driver; it IS the driver.
    yourCar: me ? { seatName: me.name, team: TEAMS[me.teamId] ?? `team ${me.teamId}` } : null,
    lastLap: formatLapTime(me?.lastLapMs),
    bestLap: formatLapTime(p?.bestLapMs),
    currentLapInvalid: p?.lapInvalid ?? null,
    gapAhead: ahead && me ? { driver: ahead.name, gap: formatDelta(me.deltaToCarInFrontMs) } : null,
    gapBehind: behind
      ? { driver: behind.name, gap: formatDelta(behind.deltaToCarInFrontMs) }
      : null,
    tyre: me
      ? `${me.tyreVisual ?? '?'} (${me.tyreActual ?? '?'}), ${me.tyreAgeLaps ?? '?'} laps old`
      : null,
    tyreWearPct: p ? wheels(p.tyreWear) : null,
    fuelKg: p ? r1(p.fuelKg) : null,
    fuelMarginLaps: p ? r1(p.fuelMarginLaps) : null,
    ersPct: p ? Math.round(p.ersPercent) : null,
    pitWindow: s.session?.pitWindowIdealLap
      ? {
          idealLap: s.session.pitWindowIdealLap,
          latestLap: s.session.pitWindowLatestLap,
          rejoinPosition: s.session.pitRejoinPosition,
        }
      : null,
    pitStops: me?.numPitStops ?? null,
    // 'Pitting' = in the pit lane now, 'In pit area' = in the box.
    pitLane: me && me.pitStatus > 0 ? (PIT_STATUS[me.pitStatus] ?? 'Pitting') : null,
    penalties: me
      ? {
          unservedTimeSec: me.penaltiesSec,
          servedAtNextStop: me.servePenaltyAtNextStop,
          warnings: me.warnings,
          unservedDriveThroughs: me.unservedDriveThroughs,
          unservedStopGos: me.unservedStopGos,
        }
      : null,
  }
}

export function lapHistoryView(s: RaceSnapshot, last = 15) {
  const laps = s.player?.laps ?? []
  return {
    bestLap: formatLapTime(s.player?.bestLapMs),
    laps: laps.slice(-last).map((l) => ({
      lap: l.lapNumber,
      time: formatLapTime(l.lapTimeMs),
      s1: formatLapTime(l.sector1Ms),
      s2: formatLapTime(l.sector2Ms),
      s3: formatLapTime(l.sector3Ms),
      valid: l.valid,
      tyre: l.tyreVisual,
      tyreAge: l.tyreAgeLaps,
      fuelKg: l.fuelKg === null ? null : r1(l.fuelKg),
    })),
  }
}

function carRow(c: CarSnapshot) {
  return {
    pos: c.position,
    driver: c.name,
    you: c.isPlayer || undefined,
    team: TEAMS[c.teamId] ?? `team ${c.teamId}`,
    gapToCarAhead: c.position === 1 ? null : formatDelta(c.deltaToCarInFrontMs),
    gapToLeader: c.position === 1 ? null : formatDelta(c.deltaToLeaderMs),
    lastLap: formatLapTime(c.lastLapMs),
    bestLap: formatLapTime(c.bestLapMs),
    tyre: c.tyreVisual,
    tyreAge: c.tyreAgeLaps,
    stops: c.numPitStops,
    stints: c.stints.length > 1 ? c.stints.map((st) => st.compound).join(' > ') : undefined,
    inPit: c.pitStatus > 0 || undefined,
    timePenaltiesSec: c.penaltiesSec || undefined,
    out: c.resultStatus > 3 || undefined,
  }
}

/** Running order. `around` limits to N cars either side of the player. */
export function orderView(s: RaceSnapshot, around?: number) {
  let cars = s.cars
  const me = cars.find((c) => c.isPlayer)
  if (around !== undefined && me) {
    cars = cars.filter((c) => Math.abs(c.position - me.position) <= around)
  }
  return { order: cars.map(carRow) }
}

export function carStatusView(s: RaceSnapshot) {
  const p = s.player
  if (!p) return { available: false }
  return {
    tyreWearPct: wheels(p.tyreWear),
    tyreSurfaceTempC: wheels(p.tyreSurfaceTemp, Math.round),
    tyreInnerTempC: wheels(p.tyreInnerTemp, Math.round),
    tyrePressurePsi: wheels(p.tyrePressure),
    brakeTempC: wheels(p.brakeTemp, Math.round),
    fuelKg: r1(p.fuelKg),
    fuelMarginLaps: r1(p.fuelMarginLaps),
    fuelMix: p.fuelMix,
    brakeBiasPct: p.brakeBias,
    ersPct: Math.round(p.ersPercent),
    ersMode: p.ersMode,
    damagePct: p.damage,
  }
}

export function weatherView(s: RaceSnapshot) {
  const sess = s.session
  if (!sess) return { available: false }
  return {
    now: sess.weather,
    trackTempC: sess.trackTempC,
    airTempC: sess.airTempC,
    forecast: sess.forecast.map((f) => ({
      inMinutes: f.inMinutes,
      weather: f.weather,
      rainPct: f.rainPercent,
      trackTempC: f.trackTempC,
    })),
  }
}

export function setupView(s: RaceSnapshot) {
  const setup = s.player?.setup
  if (!setup) return { available: false }
  return { setup }
}

export function tyreSetsView(s: RaceSnapshot) {
  const ts = s.player?.tyreSets
  if (!ts) return { available: false }
  return {
    sets: ts.sets
      .map((t, i) => ({ i, ...t }))
      .filter((t) => t.available || t.fitted)
      .map((t) => ({
        compound: VISUAL_COMPOUNDS[t.visualTyreCompound] ?? `#${t.visualTyreCompound}`,
        actual: ACTUAL_COMPOUNDS[t.actualTyreCompound] ?? `#${t.actualTyreCompound}`,
        wearPct: t.wear,
        fitted: t.fitted === 1 || undefined,
        usableLifeLaps: t.usableLife,
        lapDeltaMsVsFitted: t.lapDeltaTime,
      })),
  }
}

/**
 * Targets for the driver: what lap time to hit, where the time is, and the maths of catching
 * the car ahead or holding off the car behind. All derived from this session's laps.
 */
export function paceTargetsView(s: RaceSnapshot) {
  const laps = s.player?.laps ?? []
  const valid = laps.filter((l) => l.valid && l.lapTimeMs > 0)
  const me = s.cars.find((c) => c.isPlayer)
  const last = laps.at(-1)
  const minOf = (xs: number[]) => (xs.length ? Math.min(...xs) : 0)
  const sectors = (k: 'sector1Ms' | 'sector2Ms' | 'sector3Ms') =>
    minOf(valid.map((l) => l[k]).filter((x) => x > 0))
  const bestS = [sectors('sector1Ms'), sectors('sector2Ms'), sectors('sector3Ms')]
  const ideal = bestS.every((x) => x > 0) ? bestS[0]! + bestS[1]! + bestS[2]! : 0
  const recent = valid.slice(-3)
  const avg3 = recent.length
    ? Math.round(recent.reduce((a, l) => a + l.lapTimeMs, 0) / recent.length)
    : 0

  const lastVsBestSectors =
    last && bestS.every((x) => x > 0) && last.sector1Ms && last.sector2Ms
      ? {
          s1: formatDelta(last.sector1Ms - bestS[0]!),
          s2: formatDelta(last.sector2Ms - bestS[1]!),
          s3: formatDelta(last.sector3Ms - bestS[2]!),
        }
      : null

  // Gap trend to the car ahead over recent laps, only while holding the same position.
  let gapTrendPerLapMs: number | null = null
  if (me && laps.length >= 2) {
    const same = []
    for (let i = laps.length - 1; i >= 0 && same.length < 4; i--) {
      if (laps[i]!.position !== me.position) break
      same.unshift(laps[i]!)
    }
    if (same.length >= 2)
      gapTrendPerLapMs = Math.round(
        (same.at(-1)!.gapAheadMs - same[0]!.gapAheadMs) / (same.length - 1),
      )
  }

  const { ahead, behind } = neighbours(s, me)
  const chase =
    ahead && me && me.deltaToCarInFrontMs > 0
      ? (() => {
          const gap = me.deltaToCarInFrontMs
          const closing = gapTrendPerLapMs !== null && gapTrendPerLapMs < 0 ? -gapTrendPerLapMs : 0
          return {
            driver: ahead.name,
            gap: formatDelta(gap),
            theirLastLap: formatLapTime(ahead.lastLapMs),
            theirTyre: `${ahead.tyreVisual ?? '?'}, ${ahead.tyreAgeLaps ?? '?'} laps old`,
            gapChangePerLap: gapTrendPerLapMs === null ? null : formatDelta(gapTrendPerLapMs),
            lapsToCatchAtCurrentRate: closing ? Math.ceil(gap / closing) : null,
            lapTimeToCatchIn5Laps: ahead.lastLapMs
              ? formatLapTime(ahead.lastLapMs - Math.ceil(gap / 5))
              : null,
          }
        })()
      : null
  const defend =
    behind && behind.deltaToCarInFrontMs > 0
      ? {
          driver: behind.name,
          gap: formatDelta(behind.deltaToCarInFrontMs),
          theirLastLap: formatLapTime(behind.lastLapMs),
          theirTyre: `${behind.tyreVisual ?? '?'}, ${behind.tyreAgeLaps ?? '?'} laps old`,
        }
      : null

  return {
    lapsCompleted: laps.length,
    lastLap: last ? formatLapTime(last.lapTimeMs) : null,
    lastLapValid: last?.valid ?? null,
    bestValidLap: formatLapTime(minOf(valid.map((l) => l.lapTimeMs))),
    idealLapFromBestSectors: formatLapTime(ideal),
    bestSectors: bestS.every((x) => x > 0) ? bestS.map((x) => formatLapTime(x)) : null,
    lastLapVsBestSectors: lastVsBestSectors,
    avgLast3ValidLaps: formatLapTime(avg3),
    chase,
    defend,
  }
}
