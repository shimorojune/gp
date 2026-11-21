import { formatDelta, formatLapTime } from '@gp/shared'
import { gpMark, teamColor } from '@gp/ui'
import {
  type GpBridge,
  type NotesData,
  type PreflightResult,
  type SnapshotMessage,
  type UpdateState,
  versionLabel,
} from '../ipc.ts'
import { RadioPlayer } from './audio.ts'
import { applySkin } from './text.ts'

declare global {
  interface Window {
    gp: GpBridge
  }
}

const $ = (id: string) => document.getElementById(id)!
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const stat = (k: string, v: string, cls = '') =>
  `<div class="gp-stat ${cls}"><span class="gp-stat-label">${k}</span><div class="gp-stat-value">${v}</div></div>`
const panel = (title: string, body: string) => `<span class="gp-label">${title}</span>${body}`
const STATUS: Record<string, [label: string, dot: string]> = {
  live: ['Live', 'gp-dot--live'],
  garage: ['In the garage', 'gp-dot--warn'],
  paused: ['Paused', 'gp-dot--warn'],
  'no-data': ['No data', ''],
}
/** Shows a section once it has something in it. */
function fill(id: string, html: string): void {
  const el = $(id)
  el.innerHTML = html
  el.classList.remove('hidden')
}

function render({ race, listener, recording }: SnapshotMessage): void {
  // Same rule as inGarage() in @gp/telemetry (kept local: the renderer can't load Node code).
  const parked =
    race.status === 'live' &&
    !(race.session?.sessionType ?? '').startsWith('Race') &&
    race.cars.find((c) => c.isPlayer)?.driverStatus === 0
  const [label, dot] = STATUS[parked ? 'garage' : race.status] ?? [race.status, '']
  $('status').textContent = label
  $('statusDot').className = `gp-dot ${dot}`
  $('pps').textContent = race.status === 'no-data' ? '' : `${race.packetsPerSecond} pkt/s`

  $('recLabel').textContent = recording.recording ? `Recording · ${recording.packets}` : 'Record'
  $('recDot').classList.toggle('gp-dot--live', recording.recording)
  $('rec').setAttribute('aria-pressed', String(recording.recording))

  const s = race.session
  const p = race.player
  const me = race.cars.find((c) => c.isPlayer)
  if (me) document.body.style.setProperty('--gp-team', teamColor(me.teamId))

  if (s || me) {
    const lapOf = me && s?.totalLaps ? `Lap ${me.currentLap} of ${s.totalLaps}` : ''
    const where = [s?.track, s?.sessionType, lapOf].filter(Boolean).map((x) => esc(String(x)))
    const current = `<span class="${p?.lapInvalid ? 'invalid' : ''}">${formatLapTime(me?.currentLapMs)}</span>`
    $('hero').innerHTML = `<div class="muted hero-where gp-display">${where.join(' · ')}</div>
      <div class="pos gp-display">${me ? `P${me.position}` : '-'}</div>
      <div class="gp-stats">
        ${stat('Current', current, 'gp-stat--big')}
        ${stat('Last', formatLapTime(me?.lastLapMs), 'gp-stat--big')}
        ${stat('Best', `<span class="best">${formatLapTime(p?.bestLapMs)}</span>`, 'gp-stat--big')}
      </div>`
  }

  if (s) {
    const forecast = s.forecast
      .slice(0, 5)
      .map((f) => `+${f.inMinutes}m ${f.weather} ${f.rainPercent}%`)
      .join(' · ')
    fill(
      'session',
      panel(
        'Session',
        `<div class="gp-stats">
      ${stat('Laps', s.totalLaps ? String(s.totalLaps) : '-')}${stat('Time left', `${Math.floor(s.timeLeftSec / 60)}m`)}
      ${stat('Weather', esc(s.weather))}${stat('Track / air', `${s.trackTempC}° / ${s.airTempC}°`)}
      ${stat('Safety car', esc(s.safetyCar))}${stat('Pit window', s.pitWindowIdealLap ? `L${s.pitWindowIdealLap}–${s.pitWindowLatestLap}` : '-')}
    </div><div class="forecast">${forecast || 'No forecast'}</div>`,
      ),
    )
  }

  if (p) {
    const wheels = (w: number[], d = 0, unit = '') => {
      const f = (i: number) => `${w[i]!.toFixed(d)}${unit}`
      return `<div class="wheels"><span>${f(2)}</span><span>${f(3)}</span><span>${f(0)}</span><span>${f(1)}</span></div>`
    }
    fill(
      'player',
      panel(
        'Car',
        `<div class="gp-stats">
      ${stat('Tyre', me ? `${esc(me.tyreVisual ?? '?')} <small>${esc(me.tyreActual ?? '')}, ${me.tyreAgeLaps ?? '?'} laps old</small>` : '-')}
      ${stat('Fuel', `${p.fuelKg.toFixed(1)} kg <small>${p.fuelMarginLaps >= 0 ? '+' : ''}${p.fuelMarginLaps.toFixed(2)} laps margin</small>`)}
      ${stat('ERS', `${p.ersPercent.toFixed(0)}%`)}${stat('Brake bias', `${p.brakeBias}%`)}
      ${stat('Wear', wheels(p.tyreWear, 0, '%'))}${stat('Surface', wheels(p.tyreSurfaceTemp, 0, '°'))}
      ${stat('Pressure psi', wheels(p.tyrePressure, 1))}${stat('Speed', `${p.speedKph} km/h <small>gear ${p.gear}</small>`)}
      ${stat('Pedals', `${(p.throttle * 100).toFixed(0)} / ${(p.brake * 100).toFixed(0)}`)}${stat('DRS', p.drs ? 'Open' : p.drsAllowed ? 'Available' : '-')}
    </div>`,
      ),
    )
    if (p.laps.length) {
      const rows = p.laps
        .slice(-12)
        .reverse()
        .map(
          (
            l,
          ) => `<tr class="${l.valid ? '' : 'invalid'}"><td>${l.lapNumber}</td><td>${formatLapTime(l.lapTimeMs)}</td>
            <td>${formatLapTime(l.sector1Ms)}</td><td>${formatLapTime(l.sector2Ms)}</td><td>${formatLapTime(l.sector3Ms)}</td>
            <td>${esc(l.tyreVisual ?? '?')} ${l.tyreAgeLaps ?? ''}</td><td class="num">${l.fuelKg?.toFixed(1) ?? ''}</td></tr>`,
        )
        .join('')
      fill(
        'laps',
        panel(
          'Laps',
          `<table class="gp-table"><tr><th>Lap</th><th>Time</th><th>S1</th><th>S2</th><th>S3</th><th>Tyre</th><th class="num">Fuel</th></tr>${rows}</table>`,
        ),
      )
    }
  }

  if (race.cars.length) {
    const rows = race.cars
      .map(
        (
          c,
        ) => `<tr class="${c.isPlayer ? 'me' : ''}"><td>${c.position}</td><td>${esc(displayName(c.name))}</td>
          <td class="num">${c.position === 1 ? '' : formatDelta(c.deltaToCarInFrontMs)}</td><td class="num">${formatLapTime(c.lastLapMs)}</td>
          <td>${esc(c.tyreVisual ?? '')} ${c.tyreAgeLaps ?? ''}</td><td class="num">${c.numPitStops}</td></tr>`,
      )
      .join('')
    fill(
      'order',
      panel(
        'Order',
        `<table class="gp-table"><tr><th>P</th><th>Driver</th><th class="num">Gap</th><th class="num">Last</th><th>Tyre</th><th class="num">Stops</th></tr>${rows}</table>`,
      ),
    )
  }

  const rejected = Object.entries(listener.rejected)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')
  $('diag').innerHTML =
    `UDP 0.0.0.0:${listener.port} · received ${listener.received} · parsed ${listener.parsed}${rejected ? ` · rejected ${esc(rejected)}` : ''}${recording.path ? `<br>Recording to ${esc(recording.path)}` : ''}`
}

/** 'VERSTAPPEN' -> 'Verstappen', as on the timing screens. */
const displayName = (n: string) =>
  n.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase())

window.gp.onSnapshot(render)

// Self-updater: shown only when there's something to say or do.
let update: UpdateState | null = null
function renderUpdate(s: UpdateState): void {
  update = s
  const b = $('update') as HTMLButtonElement
  const label: Partial<Record<UpdateState['phase'], string>> = {
    downloading: `Downloading v${s.version} ${s.progress ?? 0}%`,
    verifying: `Checking v${s.version}…`,
    ready: `Update to v${s.version}`,
    installing: `Installing v${s.version}…`,
    error: s.version ? `Update v${s.version} failed` : 'Update failed',
  }
  const text = label[s.phase] ?? (s.message?.startsWith('Updated') ? s.message : '')
  b.textContent = text
  b.title = s.message ?? (s.phase === 'ready' ? 'Quit GP, install the update and reopen' : '')
  b.disabled = s.phase !== 'ready' && s.phase !== 'error'
  b.classList.toggle('hidden', !text)
  b.classList.toggle('gp-button--primary', s.phase === 'ready')
}
window.gp.onUpdate(renderUpdate)
$('update').addEventListener('click', async () => {
  if (update?.phase === 'ready') {
    const why = await window.gp.installUpdate()
    if (why) renderUpdate({ ...update, message: why })
  } else renderUpdate(await window.gp.checkUpdate())
})
void window.gp.appInfo().then((a) => {
  $('ver').textContent = versionLabel(a)
})
$('rec').addEventListener('click', () => void window.gp.toggleRecording())
$('ontop').addEventListener('click', async () => {
  const on = await window.gp.toggleOnTop()
  $('ontop').setAttribute('aria-pressed', String(on))
  $('ontop').textContent = on ? 'Pinned' : 'Pin'
})

const player = new RadioPlayer()
window.gp.onAudio((m) => player.handle(m))
// GP's voice level to the overlay radio card, only while it talks (and a second after, so the
// card sees it go quiet).
let loudAt = 0
setInterval(() => {
  const l = player.level()
  if (l > 0.01) loudAt = Date.now()
  if (Date.now() - loudAt < 1_000) window.gp.radioLevel(Math.round(l * 100) / 100)
}, 66)

// ---------------------------------------------------------------- notes tab

function renderNotes(d: NotesData): void {
  const profile = $('profile') as HTMLTextAreaElement
  if (document.activeElement !== profile) profile.value = d.profile?.text ?? ''
  $('profileMeta').textContent = d.profile
    ? `Last updated ${d.profile.updatedAt.slice(0, 16).replace('T', ' ')} by ${d.profile.editedBy === 'driver' ? 'you' : 'GP'}`
    : ''
  $('notesList').innerHTML = d.notes.length
    ? d.notes
        .map(
          (n) =>
            `<div class="note"><span class="tag gp-label">${esc(n.category)}</span><span class="t">${n.track ? `<span class="where">${esc(n.track)}: </span>` : ''}${esc(n.text)}${n.source === 'engineer' ? ' <span class="faint">from GP</span>' : ''}</span><button class="gp-button" data-id="${esc(n.id)}" title="Delete note" aria-label="Delete note">Delete</button></div>`,
        )
        .join('')
    : 'Nothing yet.'
  $('sessions').innerHTML = d.sessions.length
    ? d.sessions
        .map(
          (x) =>
            `<div class="sess"><div><span class="gp-display">${esc(x.date)}</span> · ${esc(x.track)} ${esc(x.type)} <span class="faint">${x.program === 'career' ? 'career' : 'sim'}, ${esc(x.mode)}</span> · best <span class="gp-display">${esc(x.best ?? '-')}</span>${x.result ? ` · ${esc(x.result)}` : ''}</div>${x.summary ? `<div class="muted">${esc(x.summary)}</div>` : ''}</div>`,
        )
        .join('')
    : 'No sessions yet.'
}

// ---------------------------------------------------------------- views: race / notes / check

type View = 'race' | 'notes' | 'check'
async function show(v: View): Promise<void> {
  $('raceView').classList.toggle('hidden', v !== 'race')
  $('notesView').classList.toggle('hidden', v !== 'notes')
  $('checkView').classList.toggle('hidden', v !== 'check')
  for (const t of document.querySelectorAll<HTMLElement>('.gp-tab'))
    t.setAttribute('aria-selected', String(t.dataset.view === v))
  if (v === 'notes') renderNotes(await window.gp.notes())
  if (v === 'check') await runChecks()
}
for (const t of document.querySelectorAll<HTMLElement>('.gp-tab'))
  t.addEventListener('click', () => void show(t.dataset.view as View))

// ---------------------------------------------------------------- pre-flight + first-run setup

const MARK = { ok: '✓', warn: '!', fail: '✗' } as const
function renderChecks(r: PreflightResult): void {
  $('checks').innerHTML = r.checks
    .map(
      (c) =>
        `<div class="check ${c.status}"><span class="s">${MARK[c.status]}</span><span class="tag">${esc(c.label)}</span><span class="t">${esc(c.detail)}</span></div>`,
    )
    .join('')
  if (r.firstRun) $('setup').classList.remove('hidden')
  const bad = r.checks.filter((c) => c.status === 'fail').length
  $('checkDot').classList.toggle('hidden', bad === 0)
}
async function runChecks(): Promise<PreflightResult> {
  const r = await window.gp.preflight()
  renderChecks(r)
  return r
}
$('checkRun').addEventListener('click', () => void runChecks())
$('keysShow').addEventListener('click', () => $('setup').classList.toggle('hidden'))
$('keysSave').addEventListener('click', async () => {
  const r = await window.gp.saveKeys({
    deepgram: ($('dgKey') as HTMLInputElement).value,
    elevenlabs: ($('elKey') as HTMLInputElement).value,
  })
  if ('error' in r) {
    $('keysSaved').textContent = r.error
    return
  }
  ;($('dgKey') as HTMLInputElement).value = ''
  ;($('elKey') as HTMLInputElement).value = ''
  $('keysSaved').textContent = `Saved to ${r.file}. Restart GP to use them.`
  $('relaunch').classList.remove('hidden')
  await runChecks()
})
$('relaunch').addEventListener('click', () => window.gp.relaunch())
// First run, or something GP can't work without: open the Check tab straight away.
void runChecks().then((r) => {
  if (r.firstRun || r.checks.some((c) => c.status === 'fail')) void show('check')
})

$('profileSave').addEventListener('click', async () => {
  renderNotes(await window.gp.saveProfile(($('profile') as HTMLTextAreaElement).value))
  $('profileSaved').textContent = 'Saved'
  setTimeout(() => {
    $('profileSaved').textContent = ''
  }, 2000)
})
$('noteAdd').addEventListener('click', async () => {
  const text = ($('noteText') as HTMLInputElement).value.trim()
  if (!text) return
  const category = ($('noteCat') as HTMLSelectElement).value
  const track = category === 'track' ? ($('noteTrack') as HTMLInputElement).value.trim() : ''
  renderNotes(await window.gp.addNote({ category, text, ...(track ? { track } : {}) }))
  ;($('noteText') as HTMLInputElement).value = ''
})
$('noteCat').addEventListener('change', () =>
  $('noteTrack').classList.toggle('hidden', ($('noteCat') as HTMLSelectElement).value !== 'track'),
)
$('noteText').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('noteAdd').click()
})
$('notesList').addEventListener('click', async (e) => {
  const id = (e.target as HTMLElement).dataset.id
  if (id) renderNotes(await window.gp.removeNote(id))
})

$('mark').outerHTML = gpMark({ size: 18, label: '' })
void applySkin(() => window.gp.skinCss())
