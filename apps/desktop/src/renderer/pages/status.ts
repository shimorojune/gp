import type { PreflightResult, StatusInfo } from '../../ipc.ts'
import { type CheckRow, NAMES, kbd, levelMeter, patchChecks, setLevel } from '../checks.ts'
import { $, esc, setHtml, when } from '../dom.ts'
import { SECRETS, connectionLine } from '../infisical.ts'
import { get, refreshStatus, runPreflight, watch } from '../store.ts'

const GROUPS: [label: string, ids: string[]][] = [
  ['Game', ['telemetry', 'session']],
  ['Controller and audio', ['dualsense', 'ptt', 'mic', 'output']],
  ['Engineer and voice', ['claude', 'eleven', 'deepgram', 'whisper']],
  ['Data and secrets', ['infisical', 'secrets', 'postgres', 'sync']],
]

const pf = (r: PreflightResult | null, id: string) => r?.checks.find((c) => c.id === id)

/** One live row, from the status poll and (for things that rarely change) the last checks. */
function row(id: string, s: StatusInfo, r: PreflightResult | null): CheckRow {
  const name = NAMES[id] ?? id
  const base = { id, name }
  switch (id) {
    case 'telemetry':
      return s.game.receiving
        ? {
            ...base,
            state: 'ok',
            detail: `Receiving on UDP ${s.game.port}`,
            meta: `${s.game.packetsPerSecond} pkt/s`,
          }
        : {
            ...base,
            state: 'warn',
            detail: `Waiting for F1 23 on UDP ${s.game.port}. Start the game.`,
            meta: '0 pkt/s',
          }
    case 'session':
      return s.game.receiving && s.game.track
        ? {
            ...base,
            state: 'ok',
            detail: [s.game.mode, s.game.track, s.game.sessionType].filter(Boolean).join(' · '),
          }
        : {
            ...base,
            state: 'pending',
            detail: 'Nothing yet. GP detects mode, session, track and car in the first second.',
          }
    case 'dualsense':
      return s.controller.connected
        ? {
            ...base,
            state: 'ok',
            detail: `Connected over ${s.controller.transport === 'bluetooth' ? 'Bluetooth. Its mic needs USB.' : 'USB'}`,
          }
        : {
            ...base,
            state: 'warn',
            detail: 'Not found. Plug it in with USB for push-to-talk and the mic.',
          }
    case 'ptt':
      return s.controller.connected
        ? {
            ...base,
            state: 'ok',
            detail: 'Hold to talk, press again to cut GP off',
            meta: kbd(s.controller.pushToTalk || 'L3'),
          }
        : { ...base, state: 'warn', detail: 'No controller, so no push-to-talk button.' }
    case 'mic': {
      const p = s.mic.permission
      return {
        ...base,
        state: p === 'granted' ? 'ok' : p === 'not-determined' ? 'warn' : 'fail',
        detail:
          p === 'granted'
            ? `Allowed${s.mic.running ? ' · listening' : ''}`
            : p === 'not-determined'
              ? 'macOS asks the first time you press push-to-talk.'
              : 'Denied. System Settings → Privacy & Security → Microphone → turn GP on.',
        meta: s.mic.running ? levelMeter() : '',
      }
    }
    case 'output':
      return s.outputDevice
        ? { ...base, state: 'ok', detail: `${s.outputDevice} · GP speaks here` }
        : { ...base, state: 'warn', detail: 'Unknown. GP speaks on the default output.' }
    case 'claude':
      return {
        ...base,
        state: s.claude.auth === 'none' || s.claude.lastError ? 'fail' : 'ok',
        detail:
          s.claude.auth === 'none'
            ? 'Off. CLAUDE_CODE_OAUTH_TOKEN is missing from Infisical.'
            : s.claude.lastError
              ? `Last call failed: ${s.claude.lastError}`
              : 'Setup token from Infisical · Max plan',
        meta:
          s.claude.lastLatencyMs != null
            ? `last call ${(s.claude.lastLatencyMs / 1000).toFixed(1)} s`
            : '',
      }
    case 'eleven': {
      const on = s.voice.tts === 'elevenlabs'
      const left = s.elevenLabs.charactersLeft
      return on
        ? {
            ...base,
            state: left != null && left < 2000 ? 'warn' : 'ok',
            detail:
              left != null && left < 2000
                ? 'Nearly out of credits. Short lines still play from the cache.'
                : 'Key OK · GP voice',
            meta: left != null ? `${left.toLocaleString('en-GB')} credits` : '',
          }
        : { ...base, state: 'warn', detail: 'No key. GP speaks with the Mac voice.' }
    }
    case 'deepgram':
      return s.voice.stt === 'deepgram'
        ? { ...base, state: 'ok', detail: 'Key OK · hears your push-to-talk' }
        : { ...base, state: 'warn', detail: 'No key. Using offline speech instead.' }
    case 'whisper':
      return s.voice.sttFallbackReady
        ? { ...base, state: 'ok', detail: 'Ready (whisper.cpp). Used if Deepgram is down.' }
        : {
            ...base,
            state: s.voice.stt === 'deepgram' ? 'warn' : 'fail',
            detail: pf(r, 'whisper')?.detail ?? 'Not installed.',
          }
    case 'infisical': {
      const sec = s.secrets
      const l = connectionLine(sec)
      const st = !sec.configured ? 'warn' : sec.source === 'infisical' ? 'ok' : 'fail'
      const where = sec.config ? ` · ${sec.config.environment} · ${sec.config.secretPath}` : ''
      return {
        ...base,
        state: st,
        detail: !sec.configured
          ? 'Not set up yet. Settings → Connections.'
          : sec.source === 'infisical'
            ? `Connected${where}`
            : `${l.text}${sec.error ? `. ${sec.error}` : ''}`,
        meta: sec.fetchedAt ? `fetched ${when(sec.fetchedAt)}` : '',
      }
    }
    case 'secrets': {
      const n = SECRETS.filter(([k]) => s.secrets.found[k]).length
      const missing = SECRETS.filter(([k]) => !s.secrets.found[k]).map(([k]) => k)
      return {
        ...base,
        state: n === SECRETS.length ? 'ok' : s.secrets.configured ? 'warn' : 'pending',
        detail:
          n === SECRETS.length
            ? `All ${n} found`
            : `${n} of ${SECRETS.length} in Infisical. Missing ${missing.join(', ')}`,
      }
    }
    case 'postgres': {
      const d = s.database
      const c = pf(r, 'postgres')
      return !d.configured
        ? {
            ...base,
            state: 'warn',
            detail: 'No DATABASE_URL yet. Everything stays on this Mac until then.',
          }
        : d.error
          ? {
              ...base,
              state: 'fail',
              detail: `Can't connect: ${d.error}. Sessions wait on this Mac.`,
            }
          : { ...base, state: 'ok', detail: c?.status === 'ok' ? c.detail : 'Connected' }
    }
    case 'sync': {
      const d = s.database
      return !d.configured
        ? { ...base, state: 'pending', detail: 'Starts once Postgres is set up.' }
        : d.pending
          ? {
              ...base,
              state: 'warn',
              detail: `${d.pending} ${d.pending === 1 ? 'session' : 'sessions'} waiting to sync`,
            }
          : {
              ...base,
              state: 'ok',
              detail: `Up to date${d.lastSyncAt ? `, last synced ${when(d.lastSyncAt)}` : ''}`,
            }
    }
  }
  return { ...base, state: 'pending', detail: '' }
}

export function statusPage(root: HTMLElement): () => void {
  root.innerHTML = `<div class="page gp-page">
<div class="page-head"><div><h1 class="title">Status</h1><p class="sub">Live. The start-up checks run this same list once when GP opens.</p></div><span class="spacer"></span><button class="gp-button" data-rerun>Run start-up checks</button></div>
<div class="status-sum gp-enter" data-sum></div>
<div class="groups">${GROUPS.map(([label], i) => `<section class="gp-panel gp-enter" style="--i: ${i}"><span class="gp-label">${esc(label)}</span><div class="gp-checks gp-checks--live" data-group="${i}"></div></section>`).join('')}</div>
</div>`
  const rerun = $<HTMLButtonElement>('[data-rerun]', root)
  rerun.addEventListener('click', async () => {
    rerun.disabled = true
    rerun.innerHTML = '<span class="gp-spinner"></span>Checking…'
    await runPreflight().catch(() => null)
    rerun.disabled = false
    rerun.textContent = 'Run start-up checks'
  })
  if (!get().preflight) void runPreflight().catch(() => null)
  // Fast while this page is open: the mic meter needs about 10 readings a second.
  const fast = setInterval(() => void refreshStatus(), 120)
  const unwatch = watch(['status', 'preflight'], ({ status: s, preflight: r }) => {
    if (!s) return
    const all: CheckRow[] = []
    GROUPS.forEach(([, ids], i) => {
      const rows = ids.map((id) => row(id, s, r))
      all.push(...rows)
      patchChecks($(`[data-group="${i}"]`, root), rows)
    })
    setLevel(root, s.micLevel)
    const bad = all.some((c) => c.state === 'fail')
    // Waiting for the game is fine when you're not driving.
    const need = all.filter(
      (c) => (c.state === 'warn' || c.state === 'fail') && c.id !== 'telemetry',
    ).length
    const title = s.game.receiving
      ? need
        ? `On track. ${need} ${need === 1 ? 'thing needs' : 'things need'} a look after the session.`
        : 'On track. Everything GP needs is working.'
      : bad
        ? 'Something needs you before the next race.'
        : need === 0
          ? 'Ready to race. Start F1 23 and drive.'
          : `${need} ${need === 1 ? 'thing needs' : 'things need'} a look before the next race.`
    setHtml(
      $('[data-sum]', root),
      `<span class="gp-dot ${bad ? 'gp-dot--bad' : need ? 'gp-dot--warn' : 'gp-dot--good gp-dot--pulse'}" style="width: 10px; height: 10px"></span><span class="big">${esc(title)}</span>`,
    )
  })
  return () => {
    clearInterval(fast)
    unwatch()
  }
}
