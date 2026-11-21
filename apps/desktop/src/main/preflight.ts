import { execFile } from 'node:child_process'
import { constants, accessSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { defaultWhisperModel, dualSenseConnected } from '@gp/voice'
import type { PreflightCheck, SecretsStatusInfo } from '../ipc.ts'

/**
 * Pre-flight: everything GP needs before a session, each with what to do about it. Shown in the
 * dashboard's Check tab, which opens by itself on first run or when something is broken.
 */
export interface PreflightDeps {
  home: string
  /** ms since the last UDP packet, or null if none yet this run. */
  telemetryAgeMs: () => number | null
  port: number
  micAccess: () => string
  /** Infisical connection and which expected secrets it returned. */
  secrets?: () => SecretsStatusInfo
  /** Postgres: null when DATABASE_URL isn't set. */
  database?: () => Promise<{
    connected: boolean
    version: number | null
    error: string | null
    sync: {
      pending: number
      oldestPendingAt: string | null
      lastSyncAt: string | null
      error: string | null
    }
  } | null>
}

const run = (cmd: string, args: string[]) =>
  new Promise<boolean>((resolve) =>
    execFile(cmd, args, { timeout: 10_000 }, (err) => resolve(!err)),
  )

export async function preflight(d: PreflightDeps): Promise<PreflightCheck[]> {
  const checks: PreflightCheck[] = []
  const add = (c: PreflightCheck) => checks.push(c)

  let writable = false
  try {
    accessSync(d.home, constants.W_OK)
    writable = true
  } catch {}
  add({
    id: 'home',
    label: 'Data folder',
    status: writable ? 'ok' : 'fail',
    detail: writable ? d.home : `${d.home} is missing or not writable`,
  })

  const sec = d.secrets?.()
  if (sec) {
    const ago = sec.fetchedAt ? `, fetched ${sec.fetchedAt.slice(0, 16).replace('T', ' ')} UTC` : ''
    add({
      id: 'infisical',
      label: 'Infisical',
      status: !sec.configured ? 'warn' : sec.source === 'infisical' ? 'ok' : 'fail',
      detail: !sec.configured
        ? 'Not set up yet. GP needs it for every key. Settings → Connections.'
        : sec.source === 'infisical'
          ? `Connected to ${sec.config?.siteUrl ?? 'Infisical'} (${sec.config?.environment}${sec.config?.secretPath})${ago}`
          : `${sec.error ?? 'Could not fetch secrets'}. GP has no secrets until Infisical answers.`,
    })
    const missing = Object.entries(sec.found)
      .filter(([, v]) => !v)
      .map(([k]) => k)
    add({
      id: 'secrets',
      label: 'Secrets',
      status: missing.length === 0 ? 'ok' : 'warn',
      detail:
        missing.length === 0
          ? 'All four found in Infisical'
          : `Missing from Infisical: ${missing.join(', ')}`,
    })
  }

  if (d.database) {
    const db = await d.database()
    add({
      id: 'postgres',
      label: 'Postgres',
      status: !db ? 'warn' : db.connected ? 'ok' : 'fail',
      detail: !db
        ? 'No DATABASE_URL yet. Add it to Infisical. Until then GP keeps everything on this Mac.'
        : db.connected
          ? `Connected, schema version ${db.version}`
          : `Can't connect: ${db.error}. Sessions wait on this Mac and sync later.`,
    })
    if (db) {
      const waitingMs = db.sync.oldestPendingAt
        ? Date.now() - Date.parse(db.sync.oldestPendingAt)
        : 0
      add({
        id: 'sync',
        label: 'Sync',
        status: db.sync.pending === 0 ? 'ok' : waitingMs > 86_400_000 ? 'warn' : 'ok',
        detail:
          db.sync.pending === 0
            ? `Up to date${db.sync.lastSyncAt ? `, last synced ${db.sync.lastSyncAt.slice(0, 16).replace('T', ' ')} UTC` : ''}`
            : `${db.sync.pending} session(s) waiting to sync${db.sync.error ? `: ${db.sync.error}` : ''}`,
      })
    }
  }

  // The environment only ever holds what Infisical returned (main/secrets.ts).
  const dg = !!process.env.DEEPGRAM_API_KEY
  const el = !!process.env.ELEVENLABS_API_KEY
  add({
    id: 'keys',
    label: 'Voice API keys',
    status: dg && el ? 'ok' : 'warn',
    detail:
      dg && el
        ? 'Deepgram and ElevenLabs keys loaded from Infisical'
        : `${[!dg && 'DEEPGRAM_API_KEY (GP hears you with local whisper instead)', !el && 'ELEVENLABS_API_KEY (GP speaks with the Mac voice instead)'].filter(Boolean).join(' and ')} missing from Infisical.`,
  })

  const token = !!process.env.CLAUDE_CODE_OAUTH_TOKEN
  add({
    id: 'claude',
    label: 'Claude login',
    status: token ? 'ok' : 'fail',
    detail: token
      ? 'Using your Claude setup token from Infisical (Max plan)'
      : 'CLAUDE_CODE_OAUTH_TOKEN is missing from Infisical. The engineer is off until it is there.',
  })

  const ffmpeg = await run('/usr/bin/which', [process.env.GP_FFMPEG ?? 'ffmpeg'])
  add({
    id: 'ffmpeg',
    label: 'ffmpeg (microphone)',
    status: ffmpeg ? 'ok' : 'fail',
    detail: ffmpeg ? 'Found' : 'Not found. Install with `brew install ffmpeg`.',
  })

  const mic = d.micAccess()
  add({
    id: 'mic',
    label: 'Microphone permission',
    status: mic === 'granted' ? 'ok' : mic === 'not-determined' ? 'warn' : 'fail',
    detail:
      mic === 'granted'
        ? 'Allowed'
        : mic === 'not-determined'
          ? 'macOS asks the first time you press push-to-talk.'
          : 'Denied. System Settings → Privacy & Security → Microphone → turn GP on.',
  })

  const pad = (() => {
    try {
      return dualSenseConnected()
    } catch {
      return false
    }
  })()
  add({
    id: 'dualsense',
    label: 'DualSense',
    status: pad ? 'ok' : 'warn',
    detail: pad
      ? 'Connected (its mic only works over USB)'
      : 'Not found. Plug it in with USB for push-to-talk and the mic.',
  })

  const model = process.env.GP_WHISPER_MODEL ?? defaultWhisperModel()
  const whisper =
    existsSync(model) &&
    (await run('/usr/bin/which', [process.env.GP_WHISPER_BIN ?? 'whisper-cli']))
  add({
    id: 'whisper',
    label: 'Offline speech fallback',
    status: whisper ? 'ok' : dg ? 'warn' : 'fail',
    detail: whisper
      ? 'whisper-cli and the base.en model are there'
      : `Needs \`brew install whisper-cpp\` and the base.en model. ${dg ? 'Only used if Deepgram is down.' : 'Without Deepgram this is how GP hears you.'}`,
  })

  const age = d.telemetryAgeMs()
  add({
    id: 'telemetry',
    label: 'F1 23 telemetry',
    status: age !== null && age < 10_000 ? 'ok' : 'warn',
    detail:
      age !== null && age < 10_000
        ? `Receiving on UDP ${d.port}`
        : `Nothing on UDP ${d.port} yet. In F1 23: Settings → Telemetry: UDP On, Broadcast Off, IP 127.0.0.1, port ${d.port}, format 2023, Your Telemetry Public.`,
  })
  return checks
}
