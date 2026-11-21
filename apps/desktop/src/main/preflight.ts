import { execFile } from 'node:child_process'
import { constants, accessSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defaultWhisperModel, dualSenseConnected } from '@gp/voice'
import type { PreflightCheck, SecretsStatusInfo, SetupKeys } from '../ipc.ts'

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
  /** Infisical connection and which expected secrets are in the environment. */
  secrets?: () => SecretsStatusInfo
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
      status: !sec.configured
        ? 'warn'
        : sec.source === 'infisical'
          ? 'ok'
          : sec.source === 'cache'
            ? 'warn'
            : 'fail',
      detail: !sec.configured
        ? 'Not set up. Settings → Connections: add your Infisical machine identity.'
        : sec.source === 'infisical'
          ? `Connected to ${sec.config?.siteUrl ?? 'Infisical'} (${sec.config?.environment}${sec.config?.secretPath})${ago}`
          : sec.source === 'cache'
            ? `Using the secrets cached on this Mac${ago}. ${sec.error ?? ''}`.trim()
            : `${sec.error ?? 'Could not fetch secrets'}. No cached secrets on this Mac.`,
    })
    const missing = Object.entries(sec.found)
      .filter(([, v]) => !v)
      .map(([k]) => k)
    add({
      id: 'secrets',
      label: 'Secrets',
      status: missing.length === 0 ? 'ok' : 'warn',
      detail: missing.length === 0 ? 'All four found' : `Missing ${missing.join(', ')}`,
    })
  }

  const envFile = join(d.home, '.env')
  const dg = !!process.env.DEEPGRAM_API_KEY
  const el = !!process.env.ELEVENLABS_API_KEY
  add({
    id: 'keys',
    label: 'Voice API keys',
    status: dg && el ? 'ok' : 'warn',
    detail:
      dg && el
        ? `Deepgram and ElevenLabs keys loaded${sec?.source === 'infisical' || sec?.source === 'cache' ? ' from Infisical' : ` from ${envFile}`}`
        : `${[!dg && 'Deepgram (speech to text, falls back to local whisper)', !el && 'ElevenLabs (GP’s voice, falls back to the Mac voice)'].filter(Boolean).join(' and ')} missing. Add below.`,
  })

  // Claude Code login: the keychain item (no secret is read) or the credentials file.
  const keychain = await run('security', ['find-generic-password', '-s', 'Claude Code-credentials'])
  const file = existsSync(join(homedir(), '.claude', '.credentials.json'))
  const apiKey = !!process.env.ANTHROPIC_API_KEY
  const token = !!process.env.CLAUDE_CODE_OAUTH_TOKEN
  add({
    id: 'claude',
    label: 'Claude login',
    status: keychain || file || apiKey || token ? 'ok' : 'fail',
    detail:
      keychain || file || apiKey || token
        ? `Using ${token ? 'your Claude setup token (Max plan)' : apiKey ? 'ANTHROPIC_API_KEY (billed per call)' : 'your Claude Code login'}`
        : 'No Claude Code login found. Install Claude Code and run `claude` once in Terminal to sign in.',
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
      : `Needs \`brew install whisper-cpp\` and ${model}. ${dg ? 'Only used if Deepgram is down.' : 'Without Deepgram this is how GP hears you.'}`,
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

/** First-run setup: write the API keys into <home>/.env, keeping any other lines in it. */
export function saveKeys(home: string, keys: SetupKeys): string {
  const file = join(home, '.env')
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : []
  const set = (name: string, value: string | undefined) => {
    const v = value?.trim()
    if (!v) return
    if (!/^[\w.-]+$/.test(v)) throw new Error(`${name} doesn't look like an API key`)
    const i = lines.findIndex((l) => l.replace(/^export\s+/, '').startsWith(`${name}=`))
    if (i >= 0) lines[i] = `${name}=${v}`
    else lines.push(`${name}=${v}`)
    process.env[name] = v
  }
  set('DEEPGRAM_API_KEY', keys.deepgram)
  set('ELEVENLABS_API_KEY', keys.elevenlabs)
  writeFileSync(file, `${lines.filter((l, i) => l || i < lines.length - 1).join('\n')}\n`, {
    mode: 0o600,
  })
  return file
}
