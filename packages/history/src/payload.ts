import { createHash } from 'node:crypto'
import type { HistoryDb } from './db.ts'

/**
 * One session with everything hanging off it, keyed by the game's session uid instead of local
 * row ids, so it can move between the local SQLite copy and Postgres unchanged. Setups travel by
 * their key (a hash of the setup), never by local id.
 */
export interface SessionPayload {
  session: Row
  laps: Row[]
  incidents: Row[]
  classification: Row[]
  trace: Row | null
  trackIncidents: Row[]
  setups: { key: string; data: string; first_seen: string }[]
}

export type Row = Record<string, string | number | null>

/** Child tables, their local columns that aren't copied, and how they're ordered. */
const CHILDREN = {
  laps: 'lap',
  incidents: 'id',
  classification: 'position',
} as const

const columns = new Map<string, Set<string>>()
function tableColumns(h: HistoryDb, table: string): Set<string> {
  let c = columns.get(table)
  if (!c) {
    const rows = h.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    c = new Set(rows.map((r) => r.name))
    columns.set(table, c)
  }
  return c
}

function setupKey(h: HistoryDb, id: unknown): string | null {
  if (id == null) return null
  const r = h.db.prepare('SELECT key FROM setups WHERE id = ?').get(id as number) as
    | { key: string }
    | undefined
  return r?.key ?? null
}

/** Replace a row's local setup_id with the setup's key. */
function withSetupKey(h: HistoryDb, row: Row, keys: Set<string>): Row {
  if (!('setup_id' in row)) return row
  const { setup_id, ...rest } = row
  const key = setupKey(h, setup_id)
  if (key) keys.add(key)
  return { ...rest, setup_key: key }
}

export function exportSession(h: HistoryDb, uid: string): SessionPayload | null {
  const s = h.db.prepare('SELECT * FROM sessions WHERE uid = ?').get(uid) as Row | undefined
  if (!s) return null
  const id = s.id as number
  const keys = new Set<string>()
  const { id: _id, ...session } = s
  const kids = (table: keyof typeof CHILDREN) =>
    (
      h.db
        .prepare(`SELECT * FROM ${table} WHERE session_id = ? ORDER BY ${CHILDREN[table]}`)
        .all(id) as Row[]
    ).map(({ session_id: _s, id: _i, ...r }) => withSetupKey(h, r as Row, keys))
  const traceRow = h.db.prepare('SELECT * FROM traces WHERE session_id = ?').get(id) as
    | Row
    | undefined
  const trace = traceRow ? (({ session_id: _s, ...r }) => r)(traceRow) : null
  const out: SessionPayload = {
    session: withSetupKey(h, session, keys),
    laps: kids('laps'),
    incidents: kids('incidents'),
    classification: kids('classification'),
    trace,
    trackIncidents: (
      h.db
        .prepare('SELECT * FROM track_incidents WHERE session_uid = ? ORDER BY id')
        .all(uid) as Row[]
    ).map(({ id: _i, session_uid: _u, ...r }) => r),
    setups: [],
  }
  for (const key of [...keys].sort()) {
    const r = h.db
      .prepare('SELECT key, data, first_seen FROM setups WHERE key = ?')
      .get(key) as SessionPayload['setups'][number]
    out.setups.push(r)
  }
  return out
}

/** Stable fingerprint of a payload, to tell whether it changed since the last sync. */
export function payloadHash(p: SessionPayload): string {
  return createHash('sha256').update(stableJson(p)).digest('hex').slice(0, 32)
}

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`
  return JSON.stringify(v ?? null)
}

/** Write a payload into the local copy, replacing that session if it's there. */
export function importSession(h: HistoryDb, p: SessionPayload): number {
  const db = h.db
  db.exec('BEGIN')
  try {
    for (const s of p.setups)
      db.prepare('INSERT OR IGNORE INTO setups (key, data, first_seen) VALUES (?, ?, ?)').run(
        s.key,
        s.data,
        s.first_seen,
      )
    const setupId = (key: unknown) =>
      key == null
        ? null
        : ((
            db.prepare('SELECT id FROM setups WHERE key = ?').get(key as string) as
              | { id: number }
              | undefined
          )?.id ?? null)
    const local = (row: Row): Row => {
      if (!('setup_key' in row)) return row
      const { setup_key, ...rest } = row
      return { ...rest, setup_id: setupId(setup_key) }
    }
    const uid = p.session.uid as string
    db.prepare('DELETE FROM sessions WHERE uid = ?').run(uid)
    db.prepare('DELETE FROM track_incidents WHERE session_uid = ?').run(uid)
    const id = insert(h, 'sessions', local(p.session))
    for (const table of Object.keys(CHILDREN) as (keyof typeof CHILDREN)[])
      for (const r of p[table]) insert(h, table, { ...local(r), session_id: id })
    if (p.trace) insert(h, 'traces', { ...p.trace, session_id: id })
    for (const r of p.trackIncidents) insert(h, 'track_incidents', { ...r, session_uid: uid })
    db.exec('COMMIT')
    return id
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

function insert(h: HistoryDb, table: string, row: Row): number {
  const known = tableColumns(h, table)
  const cols = Object.keys(row).filter((c) => known.has(c))
  const r = h.db
    .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => row[c] ?? null))
  return Number(r.lastInsertRowid)
}
