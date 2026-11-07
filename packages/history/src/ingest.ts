import { readdirSync, statSync, unlinkSync } from 'node:fs'
import { basename, join } from 'node:path'
import { PacketId, parsePacket, readRecording, readRecordingMeta } from '@gp/telemetry'
import { SessionCollector, type SessionRecord } from './collector.ts'
import type { HistoryDb } from './db.ts'

// Motion packets are most of the bytes and nothing in the history needs them.
const SKIP = new Set<number>([PacketId.Motion, PacketId.MotionEx])
const PACKET_ID_OFFSET = 6

/** Read a .gprec file into session records (one per game session in it). */
export async function collectRecording(path: string): Promise<SessionRecord[]> {
  const meta = await readRecordingMeta(path)
  const collector = new SessionCollector(Date.parse(meta.createdAt) || 0)
  for await (const { t, buf } of readRecording(path)) {
    if (buf.length > PACKET_ID_OFFSET && SKIP.has(buf[PACKET_ID_OFFSET]!)) continue
    const res = parsePacket(buf)
    if (res.ok) collector.feed(res.packet, t)
  }
  return collector.finish()
}

export interface IngestResult {
  file: string
  sessions: SessionRecord[]
  ids: number[]
  error: string | null
}

/** Read a recording and store its sessions. Never throws: errors are recorded and returned. */
export async function ingestRecording(db: HistoryDb, path: string): Promise<IngestResult> {
  const file = basename(path)
  let bytes = 0
  try {
    bytes = statSync(path).size
    const sessions = await collectRecording(path)
    const ids: number[] = []
    for (const s of sessions) {
      const id = db.saveSession(s, file)
      if (id !== null) ids.push(id)
    }
    db.markRecording(file, bytes, sessions.length, null)
    return { file, sessions, ids, error: null }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    db.markRecording(file, bytes, 0, error)
    return { file, sessions: [], ids: [], error }
  }
}

function recordingFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.gprec'))
      .sort()
  } catch {
    return []
  }
}

/** Ingest every recording in `dir` the database hasn't seen yet, oldest first. */
export async function backfill(
  db: HistoryDb,
  dir: string,
  opts: { skip?: (path: string) => boolean; onResult?: (r: IngestResult) => void } = {},
): Promise<IngestResult[]> {
  const out: IngestResult[] = []
  for (const f of recordingFiles(dir)) {
    const path = join(dir, f)
    if (db.hasRecording(f) || opts.skip?.(path)) continue
    const r = await ingestRecording(db, path)
    opts.onResult?.(r)
    out.push(r)
  }
  return out
}

/**
 * Keep only the newest `keep` raw recordings. Deletes only files the database has read
 * successfully, never `protect` (the file being written). Returns the deleted file names.
 */
export function pruneRecordings(
  db: HistoryDb,
  dir: string,
  keep: number,
  protect: string | null = null,
): string[] {
  const ingested = db.ingestedRecordings()
  const files = recordingFiles(dir)
  const old = files.slice(0, Math.max(0, files.length - keep))
  const deleted: string[] = []
  for (const f of old) {
    const path = join(dir, f)
    if (path === protect || !ingested.has(f)) continue
    try {
      unlinkSync(path)
      deleted.push(f)
    } catch {
      // In use or already gone; try again next time.
    }
  }
  return deleted
}
