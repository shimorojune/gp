import type { HistoryDb } from './db.ts'

/**
 * The debrief library: what the app's debrief pane lists and opens. Read-only views over the
 * local copy (which mirrors Postgres), keyed by the game's session uid.
 */

export type LibraryProgram = 'career' | 'time_trial' | 'sim'

export interface LibraryFilter {
  program?: LibraryProgram
  careerId?: string
  seasonLink?: number
  car?: string
  trackId?: number
  /** Include restarted and abandoned attempts. Default true. */
  includeAttempts?: boolean
  limit?: number
  before?: string
}

export interface LibraryItem {
  uid: string
  startedAt: string
  durationS: number
  program: LibraryProgram
  mode: string
  sessionType: string
  trackId: number
  track: string
  team: string | null
  car: string | null
  formula: string | null
  career: { id: string; name: string; season: number | null } | null
  seasonLink: number | null
  weekendLink: number | null
  status: 'finished' | 'restarted' | 'abandoned'
  replacedBy: string | null
  lapsDone: number
  validLaps: number
  bestLapMs: number | null
  finishPos: number | null
  gridPos: number | null
  numCars: number | null
  points: number | null
  flashbacks: number
  hasDebrief: boolean
  pendingSync: boolean
}

type Sec = [number | null, number | null, number | null]

export interface LibraryDetail extends LibraryItem {
  weather: string | null
  trackTempC: number | null
  airTempC: number | null
  totalLaps: number | null
  aiDifficulty: number | null
  bestSectorsMs: Sec
  idealLapMs: number | null
  medianLapMs: number | null
  consistencyMs: number | null
  fieldBestMs: number | null
  pitStops: number | null
  penaltiesS: number | null
  resultStatus: string | null
  teammate: {
    name: string
    bestMs: number | null
    pos: number | null
    points: number | null
  } | null
  laps: {
    lap: number
    lapMs: number
    sectorsMs: Sec
    valid: boolean
    tyre: string | null
    tyreAge: number | null
    fuelKg: number | null
    wearPct: number | null
    position: number | null
    flashback: boolean
    setup: number | null
  }[]
  stints: {
    fromLap: number
    toLap: number
    tyre: string | null
    laps: number
    avgLapMs: number | null
    wearPerLapPct: number | null
  }[]
  incidents: {
    lap: number | null
    kind: string
    detail: string | null
    sessionTime: number | null
    undone: boolean
  }[]
  classification: {
    position: number
    name: string
    team: string | null
    isPlayer: boolean
    grid: number | null
    points: number | null
    bestLapMs: number | null
    status: string | null
  }[]
  debrief: string | null
  setups: { key: string; values: Record<string, number> }[]
}

type R = Record<string, string | number | null>

const PROGRAM_SQL = `CASE WHEN s.program = 'career' THEN 'career'
  WHEN s.session_type = 'Time Trial' OR s.mode = 'Time Trial' THEN 'time_trial' ELSE 'sim' END`

const SELECT = `SELECT s.*, ${PROGRAM_SQL} AS prog, c.id AS career_id, c.name AS career_name,
  se.number AS season_number
  FROM sessions s
  LEFT JOIN seasons se ON se.season_link = s.season_link AND s.program = 'career'
  LEFT JOIN careers c ON c.id = se.career_id`

const n = (v: unknown) => (v == null ? null : Number(v))
const str = (v: unknown) => (v == null ? null : String(v))

function item(r: R, pending: Set<string>): LibraryItem {
  const career = r.program === 'career'
  return {
    uid: String(r.uid),
    startedAt: String(r.started_at),
    durationS: Number(r.duration_s),
    program: r.prog as LibraryProgram,
    mode: String(r.mode),
    sessionType: String(r.session_type),
    trackId: Number(r.track_id),
    track: String(r.track),
    team: str(r.team),
    car: str(r.car ?? r.team),
    formula: str(r.formula),
    career: r.career_id
      ? { id: String(r.career_id), name: String(r.career_name), season: n(r.season_number) }
      : null,
    seasonLink: career && r.season_link ? Number(r.season_link) : null,
    weekendLink: r.weekend_link ? Number(r.weekend_link) : null,
    status: (r.status as LibraryItem['status']) ?? 'finished',
    replacedBy: str(r.replaced_by),
    lapsDone: Number(r.laps_done),
    validLaps: Number(r.valid_laps),
    bestLapMs: n(r.best_lap_ms),
    finishPos: n(r.finish_pos),
    gridPos: n(r.grid_pos),
    numCars: n(r.num_cars),
    points: n(r.points),
    flashbacks: Number(r.flashbacks),
    hasDebrief: !!r.summary,
    pendingSync: pending.has(String(r.uid)),
  }
}

/** Sessions newest first, filtered. `pending` = uids not in Postgres yet. */
export function listSessions(
  h: HistoryDb,
  f: LibraryFilter = {},
  pending: Set<string> = new Set(),
): LibraryItem[] {
  const where: string[] = []
  const args: (string | number)[] = []
  if (f.program) {
    where.push(`${PROGRAM_SQL} = ?`)
    args.push(f.program)
  }
  if (f.careerId) {
    where.push('c.id = ?')
    args.push(f.careerId)
  }
  if (f.seasonLink !== undefined) {
    where.push("s.season_link = ? AND s.program = 'career'")
    args.push(f.seasonLink)
  }
  if (f.car) {
    where.push('COALESCE(s.car, s.team) = ?')
    args.push(f.car)
  }
  if (f.trackId !== undefined) {
    where.push('s.track_id = ?')
    args.push(f.trackId)
  }
  if (f.includeAttempts === false) where.push("s.status = 'finished'")
  if (f.before) {
    where.push('s.started_at < ?')
    args.push(f.before)
  }
  const limit = Math.max(1, Math.min(f.limit ?? 200, 1000))
  const rows = h.db
    .prepare(
      `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY s.started_at DESC LIMIT ${limit}`,
    )
    .all(...args) as R[]
  return rows.map((r) => item(r, pending))
}

/** Runs on one set of tyres: a new stint starts when the compound changes or the age drops. */
export function stintsOf(laps: LibraryDetail['laps']): LibraryDetail['stints'] {
  const out: LibraryDetail['stints'] = []
  let cur: LibraryDetail['laps'] = []
  const close = () => {
    if (!cur.length) return
    const valid = cur.filter((l) => l.valid && l.lapMs > 0)
    const first = cur[0]!
    const last = cur[cur.length - 1]!
    const wear =
      cur.length > 1 && first.wearPct != null && last.wearPct != null
        ? Math.round(((last.wearPct - first.wearPct) / (cur.length - 1)) * 100) / 100
        : null
    out.push({
      fromLap: first.lap,
      toLap: last.lap,
      tyre: first.tyre,
      laps: cur.length,
      avgLapMs: valid.length
        ? Math.round(valid.reduce((a, l) => a + l.lapMs, 0) / valid.length)
        : null,
      wearPerLapPct: wear,
    })
    cur = []
  }
  for (const l of laps) {
    const prev = cur[cur.length - 1]
    if (
      prev &&
      (l.tyre !== prev.tyre ||
        (l.tyreAge != null && prev.tyreAge != null && l.tyreAge < prev.tyreAge))
    )
      close()
    cur.push(l)
  }
  close()
  return out
}

export function sessionDetail(
  h: HistoryDb,
  uid: string,
  pending: Set<string> = new Set(),
): LibraryDetail | null {
  const r = h.db.prepare(`${SELECT} WHERE s.uid = ?`).get(uid) as R | undefined
  if (!r) return null
  const id = Number(r.id)
  const setupIds: number[] = []
  const setupIndex = (sid: unknown): number | null => {
    if (sid == null) return null
    let i = setupIds.indexOf(Number(sid))
    if (i < 0) i = setupIds.push(Number(sid)) - 1
    return i
  }
  if (r.setup_id != null) setupIndex(r.setup_id)
  const laps = (
    h.db.prepare('SELECT * FROM laps WHERE session_id = ? ORDER BY lap').all(id) as R[]
  ).map((l) => ({
    lap: Number(l.lap),
    lapMs: Number(l.lap_ms),
    sectorsMs: [n(l.s1_ms), n(l.s2_ms), n(l.s3_ms)] as Sec,
    valid: !!l.valid,
    tyre: str(l.tyre),
    tyreAge: n(l.tyre_age),
    fuelKg: n(l.fuel_kg),
    wearPct: n(l.wear_pct),
    position: n(l.position),
    flashback: !!l.flashback,
    setup: setupIndex(l.setup_id),
  }))
  const setups = setupIds.map((sid) => {
    const s = h.db.prepare('SELECT key, data FROM setups WHERE id = ?').get(sid) as
      | { key: string; data: string }
      | undefined
    let values: Record<string, number> = {}
    try {
      values = s ? (JSON.parse(s.data) as Record<string, number>) : {}
    } catch {}
    return { key: s?.key ?? String(sid), values }
  })
  return {
    ...item(r, pending),
    weather: str(r.weather),
    trackTempC: n(r.track_temp),
    airTempC: n(r.air_temp),
    totalLaps: n(r.total_laps),
    aiDifficulty: n(r.ai_difficulty),
    bestSectorsMs: [n(r.best_s1_ms), n(r.best_s2_ms), n(r.best_s3_ms)],
    idealLapMs: n(r.ideal_lap_ms),
    medianLapMs: n(r.median_lap_ms),
    consistencyMs: n(r.consistency_ms),
    fieldBestMs: n(r.field_best_ms),
    pitStops: n(r.pit_stops),
    penaltiesS: n(r.penalties_s),
    resultStatus: str(r.result_status),
    teammate: r.teammate
      ? {
          name: String(r.teammate),
          bestMs: n(r.teammate_best_ms),
          pos: n(r.teammate_pos),
          points: n(r.teammate_points),
        }
      : null,
    laps,
    stints: stintsOf(laps),
    incidents: (
      h.db.prepare('SELECT * FROM incidents WHERE session_id = ? ORDER BY id').all(id) as R[]
    ).map((i) => ({
      lap: n(i.lap),
      kind: String(i.kind),
      detail: str(i.detail),
      sessionTime: n(i.session_time),
      undone: !!i.undone,
    })),
    classification: (
      h.db
        .prepare('SELECT * FROM classification WHERE session_id = ? ORDER BY position')
        .all(id) as R[]
    ).map((c) => ({
      position: Number(c.position),
      name: String(c.name),
      team: str(c.team),
      isPlayer: !!c.is_player,
      grid: n(c.grid),
      points: n(c.points),
      bestLapMs: n(c.best_lap_ms),
      status: str(c.status),
    })),
    debrief: str(r.summary),
    setups,
  }
}
