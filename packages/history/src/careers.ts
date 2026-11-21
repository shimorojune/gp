import { randomUUID } from 'node:crypto'
import type { HistoryDb } from './db.ts'

/**
 * Careers above career seasons. The game gives every career season its own id but has no id for
 * the save it belongs to, so a new season shows up "unassigned" and the driver says, once,
 * whether it starts a new career or continues one. Sessions never store a career themselves:
 * they keep the game's season id and the career follows from the seasons table, so moving a
 * season moves all of it.
 */

export interface Career {
  id: string
  name: string
  createdAt: string
  seasons: { seasonLink: number; number: number | null; team: string | null }[]
}

export interface UnassignedSeason {
  seasonLink: number
  team: string | null
  firstSeen: string
  sessions: number
  tracks: string[]
}

export function listCareers(db: HistoryDb): Career[] {
  const careers = db.db
    .prepare('SELECT id, name, created_at FROM careers ORDER BY created_at')
    .all() as { id: string; name: string; created_at: string }[]
  const seasons = db.db.prepare(
    'SELECT season_link, number, team FROM seasons WHERE career_id = ? ORDER BY number, first_seen',
  )
  return careers.map((c) => ({
    id: c.id,
    name: c.name,
    createdAt: c.created_at,
    seasons: (
      seasons.all(c.id) as { season_link: number; number: number | null; team: string | null }[]
    ).map((s) => ({ seasonLink: s.season_link, number: s.number, team: s.team })),
  }))
}

/** Seasons waiting for the "new career or season N of X?" question. */
export function unassignedSeasons(db: HistoryDb): UnassignedSeason[] {
  const rows = db.db
    .prepare(
      `SELECT se.season_link, se.team, se.first_seen, COUNT(s.id) AS sessions,
         GROUP_CONCAT(DISTINCT s.track) AS tracks
       FROM seasons se LEFT JOIN sessions s ON s.season_link = se.season_link AND s.program = 'career'
       WHERE se.career_id IS NULL GROUP BY se.season_link ORDER BY se.first_seen`,
    )
    .all() as {
    season_link: number
    team: string | null
    first_seen: string
    sessions: number
    tracks: string | null
  }[]
  return rows.map((r) => ({
    seasonLink: r.season_link,
    team: r.team,
    firstSeen: r.first_seen,
    sessions: r.sessions,
    tracks: r.tracks ? r.tracks.split(',') : [],
  }))
}

/**
 * File a season under a career: an existing one (it becomes that career's next season) or a new
 * one with the given name. Returns the career id.
 */
export function assignSeason(
  db: HistoryDb,
  seasonLink: number,
  to: { careerId: string } | { newCareer: string },
  now = new Date().toISOString(),
): string {
  db.db.exec('BEGIN')
  try {
    let careerId: string
    if ('newCareer' in to) {
      const name = to.newCareer.trim()
      if (!name) throw new Error('A new career needs a name')
      careerId = randomUUID()
      db.db
        .prepare('INSERT INTO careers (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(careerId, name, now, now)
    } else {
      careerId = to.careerId
      if (!db.db.prepare('SELECT 1 FROM careers WHERE id = ?').get(careerId))
        throw new Error('No such career')
    }
    const n = db.db
      .prepare(
        'SELECT COALESCE(MAX(number), 0) + 1 AS n FROM seasons WHERE career_id = ? AND season_link != ?',
      )
      .get(careerId, seasonLink) as { n: number }
    const r = db.db
      .prepare('UPDATE seasons SET career_id = ?, number = ?, updated_at = ? WHERE season_link = ?')
      .run(careerId, n.n, now, seasonLink)
    if (r.changes === 0) throw new Error(`No season ${seasonLink}`)
    db.db.exec('COMMIT')
    return careerId
  } catch (e) {
    db.db.exec('ROLLBACK')
    throw e
  }
}

export function renameCareer(
  db: HistoryDb,
  id: string,
  name: string,
  now = new Date().toISOString(),
) {
  if (!name.trim()) throw new Error('A career needs a name')
  db.db
    .prepare('UPDATE careers SET name = ?, updated_at = ? WHERE id = ?')
    .run(name.trim(), now, id)
}

/** The career a game season belongs to, if it has been filed. */
export function careerOfSeason(
  db: HistoryDb,
  seasonLink: number,
): { id: string; name: string; season: number | null } | null {
  const r = db.db
    .prepare(
      `SELECT c.id, c.name, se.number FROM seasons se JOIN careers c ON c.id = se.career_id
       WHERE se.season_link = ?`,
    )
    .get(seasonLink) as { id: string; name: string; number: number | null } | undefined
  return r ? { id: r.id, name: r.name, season: r.number } : null
}

export interface TimeAway {
  /** The last session before now (ISO start), or null on the first ever. */
  lastAt: string | null
  lastTrack: string | null
  lastType: string | null
  /** Whole days since the last session's day, in the driver's local time zone. */
  days: number | null
  /** Sessions started in the 7 days before now. */
  sessionsLast7Days: number
}

/** How long since he last drove, from the stored sessions. `exceptUid` = the session now on. */
export function timeAway(db: HistoryDb, now: Date = new Date(), exceptUid?: string): TimeAway {
  const nowIso = now.toISOString()
  const last = db.db
    .prepare(
      `SELECT started_at, track, session_type FROM sessions
       WHERE started_at < ? AND uid != ? ORDER BY started_at DESC LIMIT 1`,
    )
    .get(nowIso, exceptUid ?? '') as
    | { started_at: string; track: string; session_type: string }
    | undefined
  const week = db.db
    .prepare(
      'SELECT COUNT(*) AS n FROM sessions WHERE started_at >= ? AND started_at < ? AND uid != ?',
    )
    .get(new Date(now.getTime() - 7 * 86_400_000).toISOString(), nowIso, exceptUid ?? '') as {
    n: number
  }
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return {
    lastAt: last?.started_at ?? null,
    lastTrack: last?.track ?? null,
    lastType: last?.session_type ?? null,
    days: last ? Math.round((day(now) - day(new Date(last.started_at))) / 86_400_000) : null,
    sessionsLast7Days: week.n,
  }
}

/** One line for the engineer at the start of a session: today's date and the gap since last time. */
export function timeAwayBrief(t: TimeAway, now: Date = new Date()): string {
  const today = now.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  const clock = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const head = `It is ${today}, ${clock} his time.`
  if (!t.lastAt || t.days === null) return `${head} First session GP has on record.`
  const when = new Date(t.lastAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const gap =
    t.days === 0
      ? 'Already drove earlier today'
      : t.days === 1
        ? 'Last drove yesterday'
        : `Last drove ${t.days} days ago`
  const ease =
    t.days >= 7
      ? ' Long gap (usually work): expect some rust, warm him up before pace targets, and never read rust as lost skill.'
      : ''
  return `${head} ${gap} (${t.lastTrack} ${t.lastType}, ${when}); ${t.sessionsLast7Days} session(s) in the last 7 days.${ease}`
}
