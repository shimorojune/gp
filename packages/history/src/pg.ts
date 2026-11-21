import pg from 'pg'
import type { HistoryDb } from './db.ts'
import {
  type Row,
  type SessionPayload,
  exportSession,
  importSession,
  payloadHash,
} from './payload.ts'

/**
 * Postgres is the system of record (docs/PLAN, "GP data store"). The radio never waits on it:
 * GP writes to the local SQLite copy during a session, and HistorySync pushes finished
 * sessions here afterwards, retrying while offline. Sessions are keyed by the game's session
 * uid and setups by their key, so a retry or a second Mac never makes duplicates.
 */

/** Numbered migrations; each runs once, in order, in its own transaction. */
export const PG_MIGRATIONS: string[] = [
  `
CREATE TABLE gp_setups (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  first_seen TEXT NOT NULL
);
CREATE TABLE gp_sessions (
  uid TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recording TEXT,
  started_at TEXT NOT NULL,
  duration_s INTEGER NOT NULL,
  track_id INTEGER NOT NULL,
  track TEXT NOT NULL,
  session_type TEXT NOT NULL,
  game_mode INTEGER NOT NULL,
  mode TEXT NOT NULL,
  program TEXT NOT NULL,
  online INTEGER NOT NULL,
  weather TEXT,
  track_temp INTEGER,
  air_temp INTEGER,
  total_laps INTEGER,
  ai_difficulty INTEGER,
  assists TEXT,
  season_link BIGINT,
  weekend_link BIGINT,
  session_link BIGINT,
  team TEXT,
  fuel_load DOUBLE PRECISION,
  setup_key TEXT REFERENCES gp_setups(key),
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
  race_time_s DOUBLE PRECISION,
  penalties_s INTEGER,
  field_best_ms INTEGER,
  num_cars INTEGER,
  teammate TEXT,
  teammate_best_ms INTEGER,
  teammate_pos INTEGER,
  teammate_points INTEGER,
  flashbacks INTEGER NOT NULL,
  warnings INTEGER NOT NULL,
  corner_cuts INTEGER NOT NULL,
  summary TEXT
);
CREATE INDEX gp_sessions_track ON gp_sessions(track_id, program, started_at);
CREATE INDEX gp_sessions_weekend ON gp_sessions(weekend_link);
CREATE TABLE gp_laps (
  session_uid TEXT NOT NULL REFERENCES gp_sessions(uid) ON DELETE CASCADE,
  lap INTEGER NOT NULL,
  lap_ms INTEGER NOT NULL,
  s1_ms INTEGER,
  s2_ms INTEGER,
  s3_ms INTEGER,
  valid INTEGER NOT NULL,
  tyre TEXT,
  tyre_age INTEGER,
  fuel_kg DOUBLE PRECISION,
  wear_pct DOUBLE PRECISION,
  position INTEGER,
  setup_key TEXT REFERENCES gp_setups(key),
  flashback INTEGER NOT NULL,
  PRIMARY KEY (session_uid, lap)
);
CREATE TABLE gp_incidents (
  session_uid TEXT NOT NULL REFERENCES gp_sessions(uid) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  lap INTEGER,
  kind TEXT NOT NULL,
  detail TEXT,
  session_time DOUBLE PRECISION,
  PRIMARY KEY (session_uid, seq)
);
CREATE TABLE gp_classification (
  session_uid TEXT NOT NULL REFERENCES gp_sessions(uid) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  team TEXT,
  is_player INTEGER NOT NULL,
  grid INTEGER,
  points INTEGER,
  best_lap_ms INTEGER,
  status TEXT,
  PRIMARY KEY (session_uid, position)
);
CREATE TABLE gp_traces (
  session_uid TEXT PRIMARY KEY REFERENCES gp_sessions(uid) ON DELETE CASCADE,
  lap INTEGER NOT NULL,
  lap_ms INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE gp_track_incidents (
  session_uid TEXT NOT NULL REFERENCES gp_sessions(uid) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  track_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  at_m DOUBLE PRECISION NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_uid, seq)
);
CREATE INDEX gp_track_incidents_track ON gp_track_incidents(track_id, at_m);
CREATE TABLE gp_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  text TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  edited_by TEXT NOT NULL
);
`,
  // 2: session status (restarts, abandoned), flashback-undone incidents, careers above seasons.
  `
ALTER TABLE gp_sessions
  ADD COLUMN status TEXT NOT NULL DEFAULT 'finished',
  ADD COLUMN replaced_by TEXT,
  ADD COLUMN ended INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN formula TEXT,
  ADD COLUMN car TEXT;
ALTER TABLE gp_incidents ADD COLUMN undone INTEGER NOT NULL DEFAULT 0;
CREATE TABLE gp_careers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE gp_seasons (
  season_link BIGINT PRIMARY KEY,
  career_id TEXT REFERENCES gp_careers(id),
  number INTEGER,
  team TEXT,
  first_seen TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
]

/** BIGINT comes back as a string by default; GP's ids all fit a JS number. */
const types = {
  getTypeParser: ((oid: number, format?: string) =>
    oid === 20
      ? (v: string) => Number(v)
      : (pg.types.getTypeParser as (o: number, f?: string) => unknown)(oid, format)) as never,
}

export class PgStore {
  readonly pool: pg.Pool

  constructor(connectionString: string, opts: { max?: number } = {}) {
    this.pool = new pg.Pool({
      connectionString,
      max: opts.max ?? 2,
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 30_000,
      types,
    })
    // An idle client dropping (Wi-Fi, server restart) must not crash the app.
    this.pool.on('error', () => {})
  }

  close(): Promise<void> {
    return this.pool.end()
  }

  /** Apply any migrations not yet applied. Returns the schema version. */
  async migrate(): Promise<number> {
    const c = await this.pool.connect()
    try {
      await c.query('SELECT pg_advisory_lock(70711)')
      await c.query(
        'CREATE TABLE IF NOT EXISTS gp_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
      )
      const { rows } = await c.query('SELECT COALESCE(MAX(version), 0) AS v FROM gp_migrations')
      let v = Number(rows[0].v)
      for (; v < PG_MIGRATIONS.length; v++) {
        await c.query('BEGIN')
        try {
          await c.query(PG_MIGRATIONS[v]!)
          await c.query('INSERT INTO gp_migrations (version) VALUES ($1)', [v + 1])
          await c.query('COMMIT')
        } catch (e) {
          await c.query('ROLLBACK')
          throw new Error(`Postgres migration ${v + 1} failed: ${(e as Error).message}`)
        }
      }
      return v
    } finally {
      await c.query('SELECT pg_advisory_unlock(70711)').catch(() => {})
      c.release()
    }
  }

  /** uid -> payload hash of every session in Postgres. */
  async sessionHashes(): Promise<Map<string, string>> {
    const { rows } = await this.pool.query('SELECT uid, payload_hash FROM gp_sessions')
    return new Map(rows.map((r) => [r.uid as string, r.payload_hash as string]))
  }

  /** Insert or replace one session and everything under it, in one transaction. */
  async pushSession(p: SessionPayload, hash = payloadHash(p)): Promise<void> {
    const c = await this.pool.connect()
    try {
      await c.query('BEGIN')
      for (const s of p.setups)
        await c.query(
          'INSERT INTO gp_setups (key, data, first_seen) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING',
          [s.key, s.data, s.first_seen],
        )
      const uid = p.session.uid as string
      await c.query('DELETE FROM gp_sessions WHERE uid = $1', [uid])
      await insert(c, 'gp_sessions', { ...p.session, payload_hash: hash })
      for (const r of p.laps) await insert(c, 'gp_laps', { ...r, session_uid: uid })
      for (const [i, r] of p.incidents.entries())
        await insert(c, 'gp_incidents', { ...r, session_uid: uid, seq: i })
      for (const r of p.classification)
        await insert(c, 'gp_classification', { ...r, session_uid: uid })
      if (p.trace) await insert(c, 'gp_traces', { ...p.trace, session_uid: uid })
      for (const [i, r] of p.trackIncidents.entries())
        await insert(c, 'gp_track_incidents', { ...r, session_uid: uid, seq: i })
      await c.query('COMMIT')
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      c.release()
    }
  }

  async pullSession(uid: string): Promise<SessionPayload | null> {
    const q = async (sql: string) => (await this.pool.query(sql, [uid])).rows as Row[]
    const [s] = await q('SELECT * FROM gp_sessions WHERE uid = $1')
    if (!s) return null
    const { payload_hash: _h, synced_at: _t, ...session } = s
    const strip = (rows: Row[], ...drop: string[]) =>
      rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.includes(k))))
    const laps = strip(
      await q('SELECT * FROM gp_laps WHERE session_uid = $1 ORDER BY lap'),
      'session_uid',
    )
    const incidents = strip(
      await q('SELECT * FROM gp_incidents WHERE session_uid = $1 ORDER BY seq'),
      'session_uid',
      'seq',
    )
    const classification = strip(
      await q('SELECT * FROM gp_classification WHERE session_uid = $1 ORDER BY position'),
      'session_uid',
    )
    const [trace] = strip(await q('SELECT * FROM gp_traces WHERE session_uid = $1'), 'session_uid')
    const trackIncidents = strip(
      await q('SELECT * FROM gp_track_incidents WHERE session_uid = $1 ORDER BY seq'),
      'session_uid',
      'seq',
    )
    const keys = [
      ...new Set([session, ...laps].map((r) => r.setup_key).filter((k): k is string => !!k)),
    ]
    const setups = keys.length
      ? ((
          await this.pool.query(
            'SELECT key, data, first_seen FROM gp_setups WHERE key = ANY($1) ORDER BY key',
            [keys],
          )
        ).rows as SessionPayload['setups'])
      : []
    return {
      session: session as Row,
      laps: laps as Row[],
      incidents: incidents as Row[],
      classification: classification as Row[],
      trace: (trace as Row | undefined) ?? null,
      trackIncidents: trackIncidents as Row[],
      setups,
    }
  }

  async profile(): Promise<{ text: string; updatedAt: string; editedBy: string } | null> {
    const { rows } = await this.pool.query(
      'SELECT text, updated_at, edited_by FROM gp_profile WHERE id = 1',
    )
    const r = rows[0]
    return r ? { text: r.text, updatedAt: r.updated_at, editedBy: r.edited_by } : null
  }

  async setProfile(p: { text: string; updatedAt: string; editedBy: string }): Promise<void> {
    await this.pool.query(
      `INSERT INTO gp_profile (id, text, updated_at, edited_by) VALUES (1, $1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET text = $1, updated_at = $2, edited_by = $3`,
      [p.text, p.updatedAt, p.editedBy],
    )
  }

  async careers(): Promise<CareerRow[]> {
    return (await this.pool.query('SELECT id, name, created_at, updated_at FROM gp_careers'))
      .rows as CareerRow[]
  }

  async seasons(): Promise<SeasonRow[]> {
    return (
      await this.pool.query(
        'SELECT season_link, career_id, number, team, first_seen, updated_at FROM gp_seasons',
      )
    ).rows as SeasonRow[]
  }

  async putCareer(r: CareerRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO gp_careers (id, name, created_at, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = $2, updated_at = $4`,
      [r.id, r.name, r.created_at, r.updated_at],
    )
  }

  async putSeason(r: SeasonRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO gp_seasons (season_link, career_id, number, team, first_seen, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (season_link) DO UPDATE SET career_id = $2, number = $3, team = $4, updated_at = $6`,
      [r.season_link, r.career_id, r.number, r.team, r.first_seen, r.updated_at],
    )
  }
}

export interface CareerRow {
  id: string
  name: string
  created_at: string
  updated_at: string
}
export interface SeasonRow {
  season_link: number
  career_id: string | null
  number: number | null
  team: string | null
  first_seen: string
  updated_at: string
}

async function insert(c: pg.PoolClient, table: string, row: Row): Promise<void> {
  const cols = Object.keys(row).filter((k) => /^[a-z_][a-z0-9_]*$/.test(k))
  await c.query(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    cols.map((k) => row[k] ?? null),
  )
}

export interface SyncStatus {
  /** Last finished sync (ISO), whether or not it pushed anything. */
  lastSyncAt: string | null
  /** Local sessions not yet in Postgres, or changed since. */
  pending: number
  /** The oldest pending session's start (ISO), for the "waiting more than a day" check. */
  oldestPendingAt: string | null
  pushed: number
  pulled: number
  error: string | null
}

/**
 * Keeps the local copy and Postgres in step: pushes every local session whose payload changed
 * since its last push, pulls sessions Postgres has that the local copy lacks (a reinstall, a
 * second Mac), and keeps the driver profile on whichever side was edited last.
 */
export class HistorySync {
  private status: SyncStatus = {
    lastSyncAt: null,
    pending: 0,
    oldestPendingAt: null,
    pushed: 0,
    pulled: 0,
    error: null,
  }
  private running: Promise<SyncStatus> | null = null

  constructor(
    private readonly local: HistoryDb,
    private readonly remote: PgStore,
  ) {
    local.db.exec(
      'CREATE TABLE IF NOT EXISTS sync_state (uid TEXT PRIMARY KEY, hash TEXT NOT NULL, synced_at TEXT NOT NULL)',
    )
  }

  /** Pending work without touching the network: what the status line and checks show. */
  localStatus(): SyncStatus {
    const pending = this.pendingLocal()
    return {
      ...this.status,
      pending: pending.length,
      oldestPendingAt: pending[0]?.started_at ?? null,
    }
  }

  /** Uids of local sessions not in Postgres yet (or changed since), for "Not synced" flags. */
  pendingUids(): Set<string> {
    return new Set(this.pendingLocal().map((p) => p.uid))
  }

  private pendingLocal(): { uid: string; started_at: string; hash: string }[] {
    const rows = this.local.db
      .prepare(
        `SELECT s.uid, s.started_at, st.hash AS synced FROM sessions s
         LEFT JOIN sync_state st ON st.uid = s.uid ORDER BY s.started_at`,
      )
      .all() as { uid: string; started_at: string; synced: string | null }[]
    const out: { uid: string; started_at: string; hash: string }[] = []
    for (const r of rows) {
      const p = exportSession(this.local, r.uid)
      if (!p) continue
      const hash = payloadHash(p)
      if (hash !== r.synced) out.push({ uid: r.uid, started_at: r.started_at, hash })
    }
    return out
  }

  /** For the start-up check: can we reach Postgres and is its schema current? */
  async check(): Promise<{
    connected: boolean
    version: number | null
    error: string | null
    sync: SyncStatus
  }> {
    try {
      const version = await this.remote.migrate()
      return { connected: true, version, error: null, sync: this.localStatus() }
    } catch (e) {
      return {
        connected: false,
        version: null,
        error: e instanceof Error ? e.message : String(e),
        sync: this.localStatus(),
      }
    }
  }

  /** Careers first (seasons point at them), each row kept from whichever side changed last. */
  private async syncCareers(): Promise<void> {
    const db = this.local.db
    const localCareers = new Map(
      (
        db
          .prepare('SELECT id, name, created_at, updated_at FROM careers')
          .all() as unknown as CareerRow[]
      ).map((r) => [r.id, r]),
    )
    const remoteCareers = await this.remote.careers()
    for (const r of remoteCareers) {
      const l = localCareers.get(r.id)
      if (!l || r.updated_at > l.updated_at)
        db.prepare(
          `INSERT INTO careers (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
        ).run(r.id, r.name, r.created_at, r.updated_at)
    }
    const remoteById = new Map(remoteCareers.map((r) => [r.id, r]))
    for (const l of localCareers.values()) {
      const r = remoteById.get(l.id)
      if (!r || l.updated_at > r.updated_at) await this.remote.putCareer(l)
    }
    const localSeasons = new Map(
      (
        db
          .prepare(
            'SELECT season_link, career_id, number, team, first_seen, updated_at FROM seasons',
          )
          .all() as unknown as SeasonRow[]
      ).map((r) => [r.season_link, r]),
    )
    const remoteSeasons = await this.remote.seasons()
    for (const r of remoteSeasons) {
      const l = localSeasons.get(r.season_link)
      if (!l || r.updated_at > l.updated_at)
        db.prepare(
          `INSERT INTO seasons (season_link, career_id, number, team, first_seen, updated_at)
           VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (season_link) DO UPDATE SET
           career_id = excluded.career_id, number = excluded.number, team = excluded.team,
           first_seen = MIN(first_seen, excluded.first_seen), updated_at = excluded.updated_at`,
        ).run(r.season_link, r.career_id, r.number, r.team, r.first_seen, r.updated_at)
    }
    const remoteByLink = new Map(remoteSeasons.map((r) => [r.season_link, r]))
    for (const l of localSeasons.values()) {
      const r = remoteByLink.get(l.season_link)
      if (!r || l.updated_at > r.updated_at) await this.remote.putSeason(l)
    }
  }

  /** One sync pass. Concurrent calls share the pass in progress. Never throws. */
  sync(): Promise<SyncStatus> {
    this.running ??= this.pass().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async pass(): Promise<SyncStatus> {
    let pushed = 0
    let pulled = 0
    try {
      await this.remote.migrate()
      const remote = await this.remote.sessionHashes()
      const mark = this.local.db.prepare(
        'INSERT INTO sync_state (uid, hash, synced_at) VALUES (?, ?, ?) ON CONFLICT (uid) DO UPDATE SET hash = excluded.hash, synced_at = excluded.synced_at',
      )
      for (const s of this.pendingLocal()) {
        if (remote.get(s.uid) !== s.hash) {
          const p = exportSession(this.local, s.uid)
          if (!p) continue
          await this.remote.pushSession(p, s.hash)
          pushed++
        }
        mark.run(s.uid, s.hash, new Date().toISOString())
      }
      const have = new Set(
        (this.local.db.prepare('SELECT uid FROM sessions').all() as { uid: string }[]).map(
          (r) => r.uid,
        ),
      )
      for (const [uid] of remote) {
        if (have.has(uid)) continue
        const p = await this.remote.pullSession(uid)
        if (!p) continue
        importSession(this.local, p)
        const hash = payloadHash(exportSession(this.local, uid)!)
        mark.run(uid, hash, new Date().toISOString())
        pulled++
      }
      await this.syncCareers()
      const lp = this.local.profile()
      const rp = await this.remote.profile()
      if (lp && (!rp || lp.updatedAt > rp.updatedAt)) await this.remote.setProfile(lp)
      else if (rp && (!lp || rp.updatedAt > lp.updatedAt))
        this.local.setProfile(rp.text, rp.editedBy as 'engineer' | 'driver', rp.updatedAt)
      this.status = {
        ...this.localStatus(),
        lastSyncAt: new Date().toISOString(),
        pushed,
        pulled,
        error: null,
      }
    } catch (e) {
      this.status = {
        ...this.localStatus(),
        pushed,
        pulled,
        error: e instanceof Error ? e.message : String(e),
      }
    }
    return this.status
  }
}
