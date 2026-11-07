import { formatLapTime } from '@gp/shared'
import type { CarSetup } from '@gp/telemetry'
import type { LapTrace } from './collector.ts'
import type { HistoryDb } from './db.ts'

// ------------------------------------------------------------------ setups

const SETUP_LABELS: Record<keyof CarSetup, string> = {
  frontWing: 'front wing',
  rearWing: 'rear wing',
  onThrottle: 'diff on throttle %',
  offThrottle: 'diff off throttle %',
  frontCamber: 'front camber',
  rearCamber: 'rear camber',
  frontToe: 'front toe',
  rearToe: 'rear toe',
  frontSuspension: 'front suspension',
  rearSuspension: 'rear suspension',
  frontAntiRollBar: 'front anti-roll bar',
  rearAntiRollBar: 'rear anti-roll bar',
  frontSuspensionHeight: 'front ride height',
  rearSuspensionHeight: 'rear ride height',
  brakePressure: 'brake pressure %',
  brakeBias: 'brake bias %',
  rearLeftTyrePressure: 'RL tyre psi',
  rearRightTyrePressure: 'RR tyre psi',
  frontLeftTyrePressure: 'FL tyre psi',
  frontRightTyrePressure: 'FR tyre psi',
  ballast: 'ballast',
  fuelLoad: 'fuel load kg',
}

const round = (n: number) => Math.round(n * 100) / 100

/** "front wing 5 -> 7" for every field that differs. Fuel is left out (it's not setup). */
export function setupDiff(from: CarSetup, to: CarSetup): string[] {
  const out: string[] = []
  for (const k of Object.keys(SETUP_LABELS) as (keyof CarSetup)[]) {
    if (k === 'fuelLoad' || typeof from[k] !== 'number' || typeof to[k] !== 'number') continue
    const a = round(from[k])
    const b = round(to[k])
    if (a !== b) out.push(`${SETUP_LABELS[k]} ${a} -> ${b}`)
  }
  return out
}

export function setupById(db: HistoryDb, id: number): CarSetup | null {
  const r = db.db.prepare('SELECT data FROM setups WHERE id = ?').get(id) as
    | { data: string }
    | undefined
  return r ? (JSON.parse(r.data) as CarSetup) : null
}

/**
 * Every setup he has driven at this track with the pace it gave, best first, and how each
 * differs from `current` (the setup in the car now). Laps, not sessions, carry the setup, so a
 * setup change mid time trial is attributed properly.
 */
export function setupHistory(db: HistoryDb, trackId: number, current: CarSetup | null) {
  const rows = db.db
    .prepare(
      `SELECT l.setup_id AS id, COUNT(*) AS laps, SUM(l.valid) AS valid, MIN(CASE WHEN l.valid = 1
         AND l.flashback = 0 THEN l.lap_ms END) AS best, MAX(s.started_at) AS last_used,
         GROUP_CONCAT(DISTINCT s.session_type) AS types
       FROM laps l JOIN sessions s ON s.id = l.session_id
       WHERE s.track_id = ? AND l.setup_id IS NOT NULL GROUP BY l.setup_id
       ORDER BY best IS NULL, best LIMIT 6`,
    )
    .all(trackId) as {
    id: number
    laps: number
    valid: number
    best: number | null
    last_used: string
    types: string
  }[]
  return rows.map((r) => {
    const data = setupById(db, r.id)
    // Median valid lap within 103% of this setup's best: its usable race pace.
    const times = (
      db.db
        .prepare(
          `SELECT l.lap_ms FROM laps l JOIN sessions s ON s.id = l.session_id
           WHERE s.track_id = ? AND l.setup_id = ? AND l.valid = 1 ORDER BY l.lap_ms`,
        )
        .all(trackId, r.id) as { lap_ms: number }[]
    )
      .map((x) => x.lap_ms)
      .filter((ms) => r.best && ms <= r.best * 1.03)
    return {
      setupId: r.id,
      laps: r.laps,
      validLaps: r.valid,
      best: r.best ? formatLapTime(r.best) : null,
      typical: times.length ? formatLapTime(times[Math.floor(times.length / 2)]!) : null,
      lastUsed: r.last_used.slice(0, 10),
      sessionTypes: r.types,
      setup: data,
      changesToCurrent: data && current ? setupDiff(data, current) : null,
    }
  })
}

// ------------------------------------------------------------------ corners

export interface CornerDelta {
  corner: number
  /** Metres into the lap of the slowest point. */
  atM: number
  minKph: number
  refMinKph: number
  /** + = braked later than the reference (metres). */
  brakeLaterM: number | null
  /** + = back on full throttle later than the reference (metres). */
  throttleLaterM: number | null
  /** Time lost (+) or gained (-) from the previous corner's exit to this one's, ms. */
  timeMs: number
}

const smooth = (xs: number[]) =>
  xs.map((x, i) => {
    const w = [xs[i - 1], x, xs[i + 1]].filter((v): v is number => v !== undefined && v >= 0)
    return w.length ? w.reduce((a, b) => a + b, 0) / w.length : -1
  })

/** Corners = slow points at least 25 kph below the fastest point in the 300 m before. */
export function findCorners(t: LapTrace): number[] {
  const v = smooth(t.speed)
  const look = Math.round(300 / t.binM)
  const out: number[] = []
  for (let i = 1; i < v.length - 1; i++) {
    const x = v[i]!
    if (x < 0 || x > (v[i - 1] ?? Infinity) || x > (v[i + 1] ?? Infinity)) continue
    const before = v.slice(Math.max(0, i - look), i).filter((s) => s >= 0)
    if (!before.length || Math.max(...before) - x < 25) continue
    // Merge minima closer than 100 m (one corner, noisy trace): keep the slower.
    const prev = out.at(-1)
    if (prev !== undefined && (i - prev) * t.binM < 100) {
      if (x < v[prev]!) out[out.length - 1] = i
      continue
    }
    out.push(i)
  }
  return out
}

function brakePoint(t: LapTrace, apex: number, from: number): number | null {
  for (let i = from; i <= apex; i++) if ((t.brake[i] ?? 0) >= 30) return i
  return null
}

function throttlePoint(t: LapTrace, apex: number, to: number): number | null {
  for (let i = apex; i < to; i++) if ((t.throttle[i] ?? 0) >= 95) return i
  return null
}

function segmentMs(t: LapTrace, from: number, to: number): number {
  let ms = 0
  for (let i = from; i < to; i++) {
    const kph = t.speed[i] ?? -1
    // Gaps in the trace (dropped packets): borrow the neighbour's speed.
    const v = kph > 0 ? kph : (t.speed[i - 1] ?? t.speed[i + 1] ?? 100)
    ms += (t.binM / (Math.max(v, 1) / 3.6)) * 1000
  }
  return ms
}

/**
 * Corner by corner: where `lap` loses or gains time against `ref` (both best-lap traces from
 * the same track), with minimum speed, braking point and throttle pickup.
 */
export function compareTraces(ref: LapTrace, lap: LapTrace): CornerDelta[] {
  const corners = findCorners(ref)
  const n = Math.min(ref.speed.length, lap.speed.length)
  const out: CornerDelta[] = []
  let segStart = 0
  corners.forEach((apex, idx) => {
    if (apex >= n) return
    const next = corners[idx + 1] ?? n
    const prevApex = corners[idx - 1] ?? 0
    // Braking zone: search from halfway since the last corner; exit: up to halfway to the next.
    const brakeFrom = Math.round((prevApex + apex) / 2)
    const exitTo = Math.min(n, Math.round((apex + next) / 2))
    const window = (t: LapTrace) =>
      Math.min(...t.speed.slice(Math.max(0, apex - 3), apex + 4).filter((s) => s >= 0))
    const rb = brakePoint(ref, apex, brakeFrom)
    const lb = brakePoint(lap, apex, brakeFrom)
    const rt = throttlePoint(ref, apex, exitTo)
    const lt = throttlePoint(lap, apex, exitTo)
    out.push({
      corner: idx + 1,
      atM: apex * ref.binM,
      minKph: window(lap),
      refMinKph: window(ref),
      brakeLaterM: rb !== null && lb !== null ? (lb - rb) * ref.binM : null,
      throttleLaterM: rt !== null && lt !== null ? (lt - rt) * ref.binM : null,
      timeMs: Math.round(segmentMs(lap, segStart, exitTo) - segmentMs(ref, segStart, exitTo)),
    })
    segStart = exitTo
  })
  // The run from the last corner to the line goes on the last corner (its exit and the
  // straight after it).
  const last = out.at(-1)
  if (last && segStart < n)
    last.timeMs += Math.round(segmentMs(lap, segStart, n) - segmentMs(ref, segStart, n))
  return out
}

/** The stored trace of his fastest clean lap at a track. */
export function pbTrace(
  db: HistoryDb,
  trackId: number,
): { lapMs: number; date: string; trace: LapTrace } | null {
  const r = db.db
    .prepare(
      `SELECT t.lap_ms, t.data, s.started_at FROM traces t JOIN sessions s ON s.id = t.session_id
       WHERE s.track_id = ? ORDER BY t.lap_ms LIMIT 1`,
    )
    .get(trackId) as { lap_ms: number; data: string; started_at: string } | undefined
  return r
    ? { lapMs: r.lap_ms, date: r.started_at.slice(0, 10), trace: JSON.parse(r.data) as LapTrace }
    : null
}

/** What GP gets: the biggest losses and gains, in plain fields. */
export function cornerReport(ref: LapTrace, lap: LapTrace, refLabel: string) {
  const d = compareTraces(ref, lap)
  const fmt = (c: CornerDelta) => ({
    corner: c.corner,
    atMetres: c.atM,
    time: `${c.timeMs >= 0 ? '+' : ''}${(c.timeMs / 1000).toFixed(2)}s`,
    minSpeed: `${c.minKph} vs ${c.refMinKph} kph`,
    braking:
      c.brakeLaterM === null
        ? null
        : c.brakeLaterM === 0
          ? 'same point'
          : `${Math.abs(c.brakeLaterM)} m ${c.brakeLaterM > 0 ? 'later' : 'earlier'}`,
    fullThrottle:
      c.throttleLaterM === null
        ? null
        : c.throttleLaterM === 0
          ? 'same point'
          : `${Math.abs(c.throttleLaterM)} m ${c.throttleLaterM > 0 ? 'later' : 'earlier'}`,
  })
  const byLoss = [...d].sort((a, b) => b.timeMs - a.timeMs)
  const total = d.reduce((a, c) => a + c.timeMs, 0)
  return {
    comparedWith: refLabel,
    corners: d.length,
    estimatedTotal: `${total >= 0 ? '+' : ''}${(total / 1000).toFixed(2)}s`,
    note: 'Corners are numbered by braking zone from the start line, not official turn numbers. Time per corner is estimated from the speed trace.',
    biggestLosses: byLoss
      .filter((c) => c.timeMs > 20)
      .slice(0, 3)
      .map(fmt),
    biggestGains: byLoss
      .filter((c) => c.timeMs < -20)
      .slice(-3)
      .reverse()
      .map(fmt),
  }
}
