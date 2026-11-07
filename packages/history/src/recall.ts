import { formatLapTime } from '@gp/shared'
import type { Program } from './collector.ts'
import type { HistoryDb } from './db.ts'

/**
 * What GP can pull out of the history. Everything here is small, pre-digested JSON or one
 * line of text: the database holds the detail, the conversation only ever sees summaries.
 */

const t = (ms: number | null | undefined) => (ms ? formatLapTime(ms) : null)
const day = (iso: string) => iso.slice(0, 10)

export interface TrackRecall {
  track: string
  sessions: { sim: number; career: number }
  lapsDriven: number
  personalBest: {
    lap: string
    lapMs: number
    date: string
    mode: string
    sessionType: string
    tyre: string | null
    setupId: number | null
  } | null
  bestSectors: { s1: string; s2: string; s3: string; ideal: string } | null
  bestSectorsMs: { s1: number; s2: number; s3: number } | null
  recent: {
    sessionId: number
    date: string
    program: Program
    type: string
    mode: string
    best: string | null
    typical: string | null
    consistencyMs: number | null
    result: string | null
    flashbacks: number
    summary: string | null
  }[]
  /** Career only: best finish and average finish at this track. */
  career: { races: number; bestFinish: number | null; avgFinish: number | null } | null
  lastSetupId: number | null
}

interface Row {
  [k: string]: unknown
}

export function trackRecall(db: HistoryDb, trackId: number, recentLimit = 5): TrackRecall | null {
  const q = db.db
  const counts = q
    .prepare(
      `SELECT program, COUNT(*) AS n, SUM(laps_done) AS laps, MAX(track) AS track
       FROM sessions WHERE track_id = ? GROUP BY program`,
    )
    .all(trackId) as { program: Program; n: number; laps: number; track: string }[]
  if (!counts.length) return null
  const sessions = { sim: 0, career: 0 }
  let lapsDriven = 0
  for (const c of counts) {
    sessions[c.program] = c.n
    lapsDriven += c.laps
  }
  const pb = q
    .prepare(
      `SELECT l.lap_ms, l.tyre, l.setup_id, s.started_at, s.mode, s.session_type
       FROM laps l JOIN sessions s ON s.id = l.session_id
       WHERE s.track_id = ? AND l.valid = 1 AND l.flashback = 0
       ORDER BY l.lap_ms LIMIT 1`,
    )
    .get(trackId) as Row | undefined
  const sec = q
    .prepare(
      `SELECT MIN(l.s1_ms) AS s1, MIN(l.s2_ms) AS s2, MIN(l.s3_ms) AS s3
       FROM laps l JOIN sessions s ON s.id = l.session_id
       WHERE s.track_id = ? AND l.valid = 1 AND l.flashback = 0`,
    )
    .get(trackId) as { s1: number | null; s2: number | null; s3: number | null }
  const recent = q
    .prepare(
      `SELECT id, started_at, program, session_type, mode, best_lap_ms, median_lap_ms,
         consistency_ms, finish_pos, grid_pos, flashbacks, summary
       FROM sessions WHERE track_id = ? ORDER BY started_at DESC LIMIT ?`,
    )
    .all(trackId, recentLimit) as Row[]
  const career = q
    .prepare(
      `SELECT COUNT(*) AS races, MIN(finish_pos) AS best, AVG(finish_pos) AS avg
       FROM sessions WHERE track_id = ? AND program = 'career' AND finish_pos IS NOT NULL`,
    )
    .get(trackId) as { races: number; best: number | null; avg: number | null }
  const lastSetup = q
    .prepare(
      'SELECT setup_id FROM sessions WHERE track_id = ? AND setup_id IS NOT NULL ORDER BY started_at DESC LIMIT 1',
    )
    .get(trackId) as { setup_id: number } | undefined
  const sectorsOk = sec.s1 && sec.s2 && sec.s3
  return {
    track: counts[0]!.track,
    sessions,
    lapsDriven,
    personalBest: pb
      ? {
          lap: formatLapTime(pb.lap_ms as number),
          lapMs: pb.lap_ms as number,
          date: day(pb.started_at as string),
          mode: pb.mode as string,
          sessionType: pb.session_type as string,
          tyre: (pb.tyre as string | null) ?? null,
          setupId: (pb.setup_id as number | null) ?? null,
        }
      : null,
    bestSectors: sectorsOk
      ? {
          s1: (sec.s1! / 1000).toFixed(3),
          s2: (sec.s2! / 1000).toFixed(3),
          s3: (sec.s3! / 1000).toFixed(3),
          ideal: formatLapTime(sec.s1! + sec.s2! + sec.s3!),
        }
      : null,
    bestSectorsMs: sectorsOk ? { s1: sec.s1!, s2: sec.s2!, s3: sec.s3! } : null,
    recent: recent.map((r) => ({
      sessionId: r.id as number,
      date: day(r.started_at as string),
      program: r.program as Program,
      type: r.session_type as string,
      mode: r.mode as string,
      best: t(r.best_lap_ms as number | null),
      typical: t(r.median_lap_ms as number | null),
      consistencyMs: (r.consistency_ms as number | null) ?? null,
      result: r.finish_pos ? `P${r.finish_pos} from P${r.grid_pos}` : null,
      flashbacks: r.flashbacks as number,
      summary: (r.summary as string | null) ?? null,
    })),
    career: career.races
      ? {
          races: career.races,
          bestFinish: career.best,
          avgFinish: career.avg === null ? null : Math.round(career.avg * 10) / 10,
        }
      : null,
    lastSetupId: lastSetup?.setup_id ?? null,
  }
}

/** Two or three lines for the start of a session at this track. ~80 tokens. */
export function trackBrief(db: HistoryDb, trackId: number): string | null {
  const r = trackRecall(db, trackId, 1)
  if (!r) return null
  const parts = [
    `History at ${r.track}: ${r.sessions.sim} sim and ${r.sessions.career} career session(s), ${r.lapsDriven} laps.`,
  ]
  if (r.personalBest)
    parts.push(
      `PB ${r.personalBest.lap} (${r.personalBest.mode} ${r.personalBest.sessionType}, ${r.personalBest.date}${r.personalBest.tyre ? `, ${r.personalBest.tyre}` : ''}).`,
    )
  if (r.bestSectors)
    parts.push(
      `Best sectors ${r.bestSectors.s1} / ${r.bestSectors.s2} / ${r.bestSectors.s3}, ideal ${r.bestSectors.ideal}.`,
    )
  const last = r.recent[0]
  if (last)
    parts.push(
      `Last time (${last.date}, ${last.type}): best ${last.best ?? 'none'}, typical ${last.typical ?? '-'}${last.result ? `, ${last.result}` : ''}.${last.summary ? ` ${last.summary}` : ''}`,
    )
  if (r.career) parts.push(`Career here: ${r.career.races} race(s), best P${r.career.bestFinish}.`)
  return parts.join(' ')
}

export function recentSessionsView(db: HistoryDb, limit = 10, program?: Program) {
  const rows = db.db
    .prepare(
      `SELECT id, started_at, program, track, session_type, mode, laps_done, valid_laps,
         best_lap_ms, median_lap_ms, consistency_ms, finish_pos, grid_pos, flashbacks, summary
       FROM sessions ${program ? 'WHERE program = ?' : ''} ORDER BY started_at DESC LIMIT ?`,
    )
    .all(...(program ? [program, limit] : [limit])) as Row[]
  return rows.map((r) => ({
    sessionId: r.id,
    date: day(r.started_at as string),
    program: r.program,
    track: r.track,
    type: r.session_type,
    mode: r.mode,
    laps: `${r.valid_laps}/${r.laps_done} valid`,
    best: t(r.best_lap_ms as number | null),
    typical: t(r.median_lap_ms as number | null),
    consistencyMs: r.consistency_ms,
    result: r.finish_pos ? `P${r.finish_pos} from P${r.grid_pos}` : null,
    flashbacks: r.flashbacks,
    summary: r.summary,
  }))
}

/** One session in detail: laps as compact strings, incidents, teammate. */
export function sessionDetailView(db: HistoryDb, sessionId: number) {
  const s = db.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as Row | undefined
  if (!s) return null
  const laps = db
    .sessionLaps(sessionId)
    .map(
      (l) =>
        `L${l.lap} ${t(l.lap_ms as number)}${l.valid ? '' : ' invalid'}${l.flashback ? ' flashback' : ''} P${l.position ?? '-'} ${l.tyre ?? ''}${l.tyre_age != null ? `(${l.tyre_age})` : ''}`,
    )
  return {
    sessionId,
    date: s.started_at,
    program: s.program,
    track: s.track,
    type: s.session_type,
    mode: s.mode,
    weather: s.weather,
    trackTempC: s.track_temp,
    team: s.team,
    best: t(s.best_lap_ms as number | null),
    ideal: t(s.ideal_lap_ms as number | null),
    typical: t(s.median_lap_ms as number | null),
    consistencyMs: s.consistency_ms,
    result: s.finish_pos
      ? { finish: s.finish_pos, grid: s.grid_pos, points: s.points, pitStops: s.pit_stops }
      : null,
    fieldBest: t(s.field_best_ms as number | null),
    teammate: s.teammate
      ? { name: s.teammate, best: t(s.teammate_best_ms as number | null), finish: s.teammate_pos }
      : null,
    setupId: s.setup_id,
    laps,
    incidents: db.incidents(sessionId).map((i) => `L${i.lap} ${i.kind}: ${i.detail}`),
    summary: s.summary,
  }
}

/**
 * Compare a lap just driven with the history at this track: is it a PB, how far off.
 * `sessionBestMs` = his best valid lap earlier in this session (not in the database yet).
 */
export function lapVsHistory(
  db: HistoryDb,
  trackId: number,
  lapMs: number,
  valid: boolean,
  sessionBestMs = 0,
): string | null {
  const r = db.db
    .prepare(
      `SELECT MIN(l.lap_ms) AS pb FROM laps l JOIN sessions s ON s.id = l.session_id
       WHERE s.track_id = ? AND l.valid = 1 AND l.flashback = 0`,
    )
    .get(trackId) as { pb: number | null }
  const pb = Math.min(...[r.pb, sessionBestMs].filter((x): x is number => !!x && x > 0))
  if (!Number.isFinite(pb) || !valid || !r.pb) return null
  const d = lapMs - pb
  if (d < 0)
    return `New personal best at this track, ${(-d / 1000).toFixed(1)}s under the old PB of ${formatLapTime(pb)}.`
  if (d <= 300) return `Within ${(d / 1000).toFixed(1)}s of his PB here (${formatLapTime(pb)}).`
  return null
}
