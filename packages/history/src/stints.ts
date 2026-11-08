import type { LapRecord } from './collector.ts'
import type { HistoryDb } from './db.ts'

interface LapRow {
  session_id: number
  session_type: string
  lap: number
  lap_ms: number
  valid: number
  tyre: string | null
  tyre_age: number | null
  fuel_kg: number | null
  wear_pct: number | null
  flashback: number
}

const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/** Least-squares slope of y over x. */
const slope = (pts: [number, number][]) => {
  if (pts.length < 3) return null
  const n = pts.length
  const mx = pts.reduce((a, p) => a + p[0], 0) / n
  const my = pts.reduce((a, p) => a + p[1], 0) / n
  const den = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0)
  return den ? pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / den : null
}

const r1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10)

/**
 * What practice (and earlier running) says about this track for a race strategy: per
 * compound, tyre wear per lap, laps until worn, and how much pace drops per lap of age;
 * plus fuel burn per lap. Prefers this race weekend's sessions, else all at the track.
 */
export function stintModel(
  db: HistoryDb,
  trackId: number,
  weekendLink?: number | null,
  /** This session's laps so far (not in the DB until the session ends). */
  live: LapRecord[] = [],
) {
  const pick = (where: string, ...args: (number | string)[]) =>
    db.db
      .prepare(
        `SELECT l.session_id, s.session_type, l.lap, l.lap_ms, l.valid, l.tyre, l.tyre_age, l.fuel_kg,
           l.wear_pct, l.flashback
         FROM laps l JOIN sessions s ON s.id = l.session_id
         WHERE s.track_id = ? ${where} ORDER BY l.session_id, l.lap`,
      )
      .all(trackId, ...args) as unknown as LapRow[]
  const liveRows: LapRow[] = live.map((l) => ({
    session_id: -1,
    session_type: 'live',
    lap: l.lap,
    lap_ms: l.lapMs,
    valid: l.valid ? 1 : 0,
    tyre: l.tyre,
    tyre_age: l.tyreAge,
    fuel_kg: l.fuelKg,
    wear_pct: l.wearPct ?? null,
    flashback: l.flashback ? 1 : 0,
  }))
  let rows = weekendLink
    ? pick('AND s.weekend_link = ? AND s.program = ?', weekendLink, 'career')
    : []
  const scope =
    weekendLink && rows.length + live.length >= 5 ? 'this weekend' : 'all sessions at this track'
  if (rows.length + live.length < 5 || !weekendLink) rows = pick('')
  rows = [...rows, ...liveRows]

  // Stints: consecutive laps in a session on one tyre with the age going up.
  const stints: LapRow[][] = []
  for (const r of rows) {
    const cur = stints.at(-1)
    const prev = cur?.at(-1)
    if (
      cur &&
      prev &&
      prev.session_id === r.session_id &&
      prev.tyre === r.tyre &&
      r.lap === prev.lap + 1 &&
      (r.tyre_age ?? 0) >= (prev.tyre_age ?? 0)
    )
      cur.push(r)
    else stints.push([r])
  }

  const byCompound = new Map<
    string,
    { wear: number[]; pace: number[]; laps: number; longest: number }
  >()
  const burns: number[] = []
  for (const st of stints) {
    for (let i = 1; i < st.length; i++) {
      const a = st[i - 1]!
      const b = st[i]!
      // Fuel used over one lap; a jump up means a refuel or a reset, skip it.
      if (
        a.fuel_kg !== null &&
        b.fuel_kg !== null &&
        a.fuel_kg - b.fuel_kg > 0.3 &&
        a.fuel_kg - b.fuel_kg < 5
      )
        burns.push(a.fuel_kg - b.fuel_kg)
    }
    const tyre = st[0]!.tyre
    if (!tyre || st.length < 3) continue
    const c = byCompound.get(tyre) ?? { wear: [], pace: [], laps: 0, longest: 0 }
    c.laps += st.length
    c.longest = Math.max(c.longest, st.length)
    const w = st.filter((l) => l.wear_pct !== null && l.tyre_age !== null)
    const ws = slope(w.map((l) => [l.tyre_age!, l.wear_pct!]))
    if (ws !== null && ws > 0) c.wear.push(ws)
    // Pace: clean laps within 3% of the stint's best (drops cool-down and traffic laps).
    const clean = st.filter((l) => l.valid && !l.flashback && l.lap_ms > 0 && l.tyre_age !== null)
    const best = Math.min(...clean.map((l) => l.lap_ms))
    const quick = clean.filter((l) => l.lap_ms <= best * 1.03)
    if (quick.length >= 4) {
      const ps = slope(quick.map((l) => [l.tyre_age!, l.lap_ms]))
      if (ps !== null) c.pace.push(ps)
    }
    byCompound.set(tyre, c)
  }

  const compounds = [...byCompound.entries()].map(([tyre, c]) => {
    const wear = median(c.wear)
    return {
      compound: tyre,
      lapsRun: c.laps,
      longestStint: c.longest,
      wearPerLapPct: r1(wear),
      lapsTo70PctWear: wear ? Math.floor(70 / wear) : null,
      paceLossPerLapMs: c.pace.length ? Math.round(median(c.pace)!) : null,
    }
  })
  const burn = median(burns)
  return {
    from: scope,
    stints: stints.filter((s) => s.length >= 3).length,
    fuelPerLapKg: r1(burn),
    compounds,
    note:
      compounds.length || burn
        ? 'From his own laps. Wear per lap and pace loss come from stints of 3+ laps; a short practice run on a compound makes its numbers rough.'
        : 'No usable practice runs here yet: do a run of 5+ laps on each race compound to learn wear, pace drop and fuel use.',
  }
}
