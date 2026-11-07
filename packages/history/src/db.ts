import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type * as Sqlite from 'node:sqlite'
import type { DatabaseSync } from 'node:sqlite'
import type { LapRecord, Program, SessionRecord } from './collector.ts'

// Loaded at runtime: vite (vitest) doesn't know node:sqlite is a builtin and fails to resolve
// a static import of it.
const { DatabaseSync: Database } = process.getBuiltinModule('node:sqlite') as typeof Sqlite

const SCHEMA_VERSION = 2

const SCHEMA = `
CREATE TABLE IF NOT EXISTS recordings (
  file TEXT PRIMARY KEY,
  bytes INTEGER NOT NULL,
  ingested_at TEXT NOT NULL,
  sessions INTEGER NOT NULL,
  error TEXT
);
CREATE TABLE IF NOT EXISTS setups (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL,
  first_seen TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  recording TEXT,
  started_at TEXT NOT NULL,
  duration_s INTEGER NOT NULL,
  track_id INTEGER NOT NULL,
  track TEXT NOT NULL,
  session_type TEXT NOT NULL,
  game_mode INTEGER NOT NULL,
  mode TEXT NOT NULL,
  program TEXT NOT NULL CHECK (program IN ('sim', 'career')),
  online INTEGER NOT NULL,
  weather TEXT,
  track_temp INTEGER,
  air_temp INTEGER,
  total_laps INTEGER,
  ai_difficulty INTEGER,
  assists TEXT,
  season_link INTEGER,
  weekend_link INTEGER,
  session_link INTEGER,
  team TEXT,
  fuel_load REAL,
  setup_id INTEGER REFERENCES setups(id),
  laps_done INTEGER NOT NULL,
  valid_laps INTEGER NOT NULL,
  best_lap_ms INTEGER,
  best_s1_ms INTEGER,
  best_s2_ms INTEGER,
  best_s3_ms INTEGER,
  ideal_lap_ms INTEGER,
  median_lap_ms INTEGER,
  consistency_ms INTEGER,
  finish_pos INTEGER,
  grid_pos INTEGER,
  points INTEGER,
  pit_stops INTEGER,
  result_status TEXT,
  race_time_s REAL,
  penalties_s INTEGER,
  field_best_ms INTEGER,
  num_cars INTEGER,
  teammate TEXT,
  teammate_best_ms INTEGER,
  teammate_pos INTEGER,
  flashbacks INTEGER NOT NULL,
  warnings INTEGER NOT NULL,
  corner_cuts INTEGER NOT NULL,
  summary TEXT
);
CREATE INDEX IF NOT EXISTS sessions_track ON sessions(track_id, program, started_at);
CREATE INDEX IF NOT EXISTS sessions_weekend ON sessions(weekend_link);
CREATE TABLE IF NOT EXISTS laps (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  lap INTEGER NOT NULL,
  lap_ms INTEGER NOT NULL,
  s1_ms INTEGER,
  s2_ms INTEGER,
  s3_ms INTEGER,
  valid INTEGER NOT NULL,
  tyre TEXT,
  tyre_age INTEGER,
  fuel_kg REAL,
  position INTEGER,
  setup_id INTEGER REFERENCES setups(id),
  flashback INTEGER NOT NULL,
  PRIMARY KEY (session_id, lap)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  lap INTEGER,
  kind TEXT NOT NULL,
  detail TEXT,
  session_time REAL
);
CREATE INDEX IF NOT EXISTS incidents_session ON incidents(session_id);
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  text TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  edited_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS traces (
  session_id INTEGER PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  lap INTEGER NOT NULL,
  lap_ms INTEGER NOT NULL,
  data TEXT NOT NULL
);
`

/** Session stats derived from its laps, so the DB never has to re-read raw laps for a summary. */
export interface LapStats {
  lapsDone: number
  validLaps: number
  bestLapMs: number | null
  bestS1Ms: number | null
  bestS2Ms: number | null
  bestS3Ms: number | null
  idealLapMs: number | null
  medianLapMs: number | null
  /** Std dev of valid laps within 103% of the best (racing laps, not in/out laps). */
  consistencyMs: number | null
}

export function lapStats(laps: LapRecord[]): LapStats {
  const valid = laps.filter((l) => l.valid && l.lapMs > 0)
  const min = (xs: number[]) => (xs.length ? Math.min(...xs) : null)
  const best = min(valid.map((l) => l.lapMs))
  const sector = (k: 's1Ms' | 's2Ms' | 's3Ms') => min(valid.map((l) => l[k]).filter((x) => x > 0))
  const s1 = sector('s1Ms')
  const s2 = sector('s2Ms')
  const s3 = sector('s3Ms')
  const racing = best === null ? [] : valid.map((l) => l.lapMs).filter((ms) => ms <= best * 1.03)
  racing.sort((a, b) => a - b)
  const median = racing.length ? racing[Math.floor(racing.length / 2)]! : null
  let consistency: number | null = null
  if (racing.length >= 3) {
    const mean = racing.reduce((a, b) => a + b, 0) / racing.length
    consistency = Math.round(
      Math.sqrt(racing.reduce((a, b) => a + (b - mean) ** 2, 0) / racing.length),
    )
  }
  return {
    lapsDone: laps.length,
    validLaps: valid.length,
    bestLapMs: best,
    bestS1Ms: s1,
    bestS2Ms: s2,
    bestS3Ms: s3,
    idealLapMs: s1 && s2 && s3 ? s1 + s2 + s3 : null,
    medianLapMs: median,
    consistencyMs: consistency,
  }
}

export interface SessionRow {
  id: number
  uid: string
  started_at: string
  track: string
  track_id: number
  session_type: string
  mode: string
  program: Program
  laps_done: number
  valid_laps: number
  best_lap_ms: number | null
  ideal_lap_ms: number | null
  median_lap_ms: number | null
  consistency_ms: number | null
  finish_pos: number | null
  grid_pos: number | null
  field_best_ms: number | null
  setup_id: number | null
  flashbacks: number
  summary: string | null
}

/**
 * GP's long-term memory of every session: the numbers, not the raw telemetry. Lives in
 * ~/Documents/GP/gp.db. node:sqlite (built into Node 22.13+/Electron 45) so there is no
 * native module to rebuild for Electron.
 */
export class HistoryDb {
  readonly db: DatabaseSync

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    const v = (this.db.prepare('PRAGMA user_version').get() as { user_version: number })
      .user_version
    if (v < SCHEMA_VERSION) {
      this.db.exec(SCHEMA)
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    }
  }

  close(): void {
    this.db.close()
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN')
    try {
      const r = fn()
      this.db.exec('COMMIT')
      return r
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  hasRecording(file: string): boolean {
    return this.db.prepare('SELECT 1 FROM recordings WHERE file = ?').get(file) !== undefined
  }

  /** Recordings that were read successfully (safe to delete the raw file). */
  ingestedRecordings(): Set<string> {
    const rows = this.db.prepare('SELECT file FROM recordings WHERE error IS NULL').all() as {
      file: string
    }[]
    return new Set(rows.map((r) => r.file))
  }

  markRecording(file: string, bytes: number, sessions: number, error: string | null): void {
    this.db
      .prepare(
        `INSERT INTO recordings (file, bytes, ingested_at, sessions, error) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(file) DO UPDATE SET bytes = excluded.bytes, ingested_at = excluded.ingested_at,
           sessions = excluded.sessions, error = excluded.error`,
      )
      .run(file, bytes, new Date().toISOString(), sessions, error)
  }

  private setupId(key: string, data: unknown, seen: string): number {
    const row = this.db.prepare('SELECT id FROM setups WHERE key = ?').get(key) as
      | { id: number }
      | undefined
    if (row) return row.id
    const r = this.db
      .prepare('INSERT INTO setups (key, data, first_seen) VALUES (?, ?, ?)')
      .run(key, JSON.stringify(data), seen)
    return Number(r.lastInsertRowid)
  }

  /**
   * Store a session. The same game session can span two recordings (app restarted mid
   * session): keep whichever copy has more laps.
   */
  saveSession(s: SessionRecord, recording: string | null): number | null {
    return this.tx(() => {
      const existing = this.db
        .prepare('SELECT id, laps_done FROM sessions WHERE uid = ?')
        .get(s.uid) as { id: number; laps_done: number } | undefined
      if (existing && existing.laps_done >= s.laps.length) return existing.id
      if (existing) this.db.prepare('DELETE FROM sessions WHERE id = ?').run(existing.id)

      const setupIds = new Map<string, number>()
      for (const [key, data] of Object.entries(s.setups))
        setupIds.set(key, this.setupId(key, data, s.startedAt))
      // The session's setup = the one most laps were driven on.
      const counts = new Map<string, number>()
      for (const l of s.laps)
        if (l.setupKey) counts.set(l.setupKey, (counts.get(l.setupKey) ?? 0) + 1)
      const mainKey =
        [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? Object.keys(s.setups)[0]
      const st = lapStats(s.laps)
      const r = this.db
        .prepare(
          `INSERT INTO sessions (uid, recording, started_at, duration_s, track_id, track, session_type,
            game_mode, mode, program, online, weather, track_temp, air_temp, total_laps, ai_difficulty,
            assists, season_link, weekend_link, session_link, team, fuel_load, setup_id, laps_done,
            valid_laps, best_lap_ms, best_s1_ms, best_s2_ms, best_s3_ms, ideal_lap_ms, median_lap_ms,
            consistency_ms, finish_pos, grid_pos, points, pit_stops, result_status, race_time_s,
            penalties_s, field_best_ms, num_cars, teammate, teammate_best_ms, teammate_pos,
            flashbacks, warnings, corner_cuts)
           VALUES (${Array(47).fill('?').join(', ')})`,
        )
        .run(
          s.uid,
          recording,
          s.startedAt,
          s.durationSec,
          s.trackId,
          s.track,
          s.sessionType,
          s.gameMode,
          s.mode,
          s.program,
          s.online ? 1 : 0,
          s.weather,
          s.trackTempC,
          s.airTempC,
          s.totalLaps,
          s.aiDifficulty,
          JSON.stringify(s.assists),
          s.seasonLink,
          s.weekendLink,
          s.sessionLink,
          s.team,
          s.fuelLoad,
          mainKey ? (setupIds.get(mainKey) ?? null) : null,
          st.lapsDone,
          st.validLaps,
          st.bestLapMs,
          st.bestS1Ms,
          st.bestS2Ms,
          st.bestS3Ms,
          st.idealLapMs,
          st.medianLapMs,
          st.consistencyMs,
          s.result?.position ?? null,
          s.result?.grid ?? null,
          s.result?.points ?? null,
          s.result?.pitStops ?? null,
          s.result?.status ?? null,
          s.result?.raceTimeSec ?? null,
          s.result?.penaltiesSec ?? null,
          s.fieldBestMs,
          s.numCars,
          s.teammate?.name ?? null,
          s.teammate?.bestLapMs || null,
          s.teammate?.position ?? null,
          s.flashbacks,
          s.warnings,
          s.cornerCutWarnings,
        )
      const id = Number(r.lastInsertRowid)
      const lap = this.db.prepare(
        `INSERT INTO laps (session_id, lap, lap_ms, s1_ms, s2_ms, s3_ms, valid, tyre, tyre_age,
          fuel_kg, position, setup_id, flashback) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const l of s.laps)
        lap.run(
          id,
          l.lap,
          l.lapMs,
          l.s1Ms || null,
          l.s2Ms || null,
          l.s3Ms || null,
          l.valid ? 1 : 0,
          l.tyre,
          l.tyreAge,
          l.fuelKg,
          l.position || null,
          l.setupKey ? (setupIds.get(l.setupKey) ?? null) : null,
          l.flashback ? 1 : 0,
        )
      const inc = this.db.prepare(
        'INSERT INTO incidents (session_id, lap, kind, detail, session_time) VALUES (?, ?, ?, ?, ?)',
      )
      for (const i of s.incidents) inc.run(id, i.lap, i.kind, i.detail, i.sessionTime)
      if (s.bestTrace) {
        const ms = s.laps.find((l) => l.lap === s.bestTrace?.lap)?.lapMs ?? 0
        this.db
          .prepare('INSERT INTO traces (session_id, lap, lap_ms, data) VALUES (?, ?, ?, ?)')
          .run(id, s.bestTrace.lap, ms, JSON.stringify(s.bestTrace))
      }
      return id
    })
  }

  recentSessions(limit = 10): SessionRow[] {
    return this.db
      .prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?')
      .all(limit) as unknown as SessionRow[]
  }

  sessionLaps(sessionId: number): Record<string, unknown>[] {
    return this.db
      .prepare('SELECT * FROM laps WHERE session_id = ? ORDER BY lap')
      .all(sessionId) as Record<string, unknown>[]
  }

  incidents(sessionId: number): Record<string, unknown>[] {
    return this.db
      .prepare('SELECT lap, kind, detail FROM incidents WHERE session_id = ? ORDER BY id')
      .all(sessionId) as Record<string, unknown>[]
  }

  /** GP's running read on the driver: strengths, weaknesses, habits, progress. ~300 tokens. */
  profile(): { text: string; updatedAt: string; editedBy: string } | null {
    const r = this.db
      .prepare('SELECT text, updated_at, edited_by FROM profile WHERE id = 1')
      .get() as { text: string; updated_at: string; edited_by: string } | undefined
    return r ? { text: r.text, updatedAt: r.updated_at, editedBy: r.edited_by } : null
  }

  setProfile(text: string, editedBy: 'engineer' | 'driver'): void {
    this.db
      .prepare(
        `INSERT INTO profile (id, text, updated_at, edited_by) VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at,
           edited_by = excluded.edited_by`,
      )
      .run(text.trim(), new Date().toISOString(), editedBy)
  }

  setSummary(sessionId: number, summary: string): void {
    this.db.prepare('UPDATE sessions SET summary = ? WHERE id = ?').run(summary, sessionId)
  }
}
