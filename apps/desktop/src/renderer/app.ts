import { formatDelta, formatLapTime } from '@gp/shared'
import type { GpBridge, NotesData, SnapshotMessage } from '../ipc.ts'
import { RadioPlayer } from './audio.ts'

declare global {
  interface Window {
    gp: GpBridge
  }
}

const $ = (id: string) => document.getElementById(id)!
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const cell = (k: string, v: string, cls = 'v') =>
  `<div><div class="k">${k}</div><div class="${cls}">${v}</div></div>`

function render({ race, listener, recording }: SnapshotMessage): void {
  const status = $('status')
  // Same rule as inGarage() in @gp/telemetry (kept local: the renderer can't load Node code).
  const parked =
    race.status === 'live' &&
    !(race.session?.sessionType ?? '').startsWith('Race') &&
    race.cars.find((c) => c.isPlayer)?.driverStatus === 0
  const shown = parked ? 'garage' : race.status
  status.textContent = shown
  status.className = `pill ${shown}`
  $('pps').textContent = `${race.packetsPerSecond} pkt/s`

  const rec = $('rec')
  rec.textContent = recording.recording ? `Stop (${recording.packets})` : 'Record'
  rec.classList.toggle('on', recording.recording)

  const s = race.session
  if (s) {
    const forecast = s.forecast
      .slice(0, 5)
      .map((f) => `+${f.inMinutes}m ${f.weather} ${f.rainPercent}%`)
      .join(' · ')
    $('session').innerHTML = `<h2>Session</h2><div class="grid">
      ${cell('Track', esc(s.track))}${cell('Session', esc(s.sessionType))}
      ${cell('Laps', s.totalLaps ? String(s.totalLaps) : '-')}${cell('Time left', `${Math.floor(s.timeLeftSec / 60)}m`)}
      ${cell('Weather', esc(s.weather))}${cell('Track / air', `${s.trackTempC}° / ${s.airTempC}°`)}
      ${cell('Safety car', esc(s.safetyCar))}${cell('Pit window', s.pitWindowIdealLap ? `L${s.pitWindowIdealLap}–L${s.pitWindowLatestLap}` : '-')}
    </div><div class="k" style="margin-top:6px">${forecast || 'No forecast'}</div>`
  }

  const p = race.player
  const me = race.cars.find((c) => c.isPlayer)
  if (p) {
    const wheels = (w: number[], d = 0, unit = '') =>
      `FL ${w[2]!.toFixed(d)}${unit} FR ${w[3]!.toFixed(d)}${unit}<br>RL ${w[0]!.toFixed(d)}${unit} RR ${w[1]!.toFixed(d)}${unit}`
    $('player').innerHTML = `<h2>Car</h2><div class="grid">
      ${cell('Position', me ? `P${me.position}` : '-', 'v big')}
      ${cell('Current', `<span class="${p.lapInvalid ? 'invalid' : ''}">${formatLapTime(me?.currentLapMs)}</span>`, 'v big')}
      ${cell('Last', formatLapTime(me?.lastLapMs))}${cell('Best', formatLapTime(p.bestLapMs))}
      ${cell('Speed', `${p.speedKph} km/h`)}${cell('Gear', String(p.gear))}
      ${cell('Throttle / brake', `${(p.throttle * 100).toFixed(0)} / ${(p.brake * 100).toFixed(0)}`)}${cell('DRS', p.drs ? 'OPEN' : p.drsAllowed ? 'available' : '-')}
      ${cell('Tyre', me ? `${esc(me.tyreVisual ?? '?')} (${esc(me.tyreActual ?? '?')}), ${me.tyreAgeLaps ?? '?'} laps` : '-')}
      ${cell('Wear %', wheels(p.tyreWear))}
      ${cell('Surface °C', wheels(p.tyreSurfaceTemp))}${cell('Pressure psi', wheels(p.tyrePressure, 1))}
      ${cell('Fuel', `${p.fuelKg.toFixed(1)} kg`)}${cell('Fuel margin', `${p.fuelMarginLaps >= 0 ? '+' : ''}${p.fuelMarginLaps.toFixed(2)} laps`)}
      ${cell('ERS', `${p.ersPercent.toFixed(0)}%`)}${cell('Brake bias', `${p.brakeBias}%`)}
    </div>`
    if (p.laps.length) {
      const rows = p.laps
        .slice(-12)
        .reverse()
        .map(
          (
            l,
          ) => `<tr class="${l.valid ? '' : 'invalid'}"><td>${l.lapNumber}</td><td>${formatLapTime(l.lapTimeMs)}</td>
            <td>${formatLapTime(l.sector1Ms)}</td><td>${formatLapTime(l.sector2Ms)}</td><td>${formatLapTime(l.sector3Ms)}</td>
            <td>${esc(l.tyreVisual ?? '?')} ${l.tyreAgeLaps ?? ''}</td><td>${l.fuelKg?.toFixed(1) ?? ''}</td></tr>`,
        )
        .join('')
      $('laps').innerHTML =
        `<h2>Laps</h2><table><tr><th>#</th><th>Time</th><th>S1</th><th>S2</th><th>S3</th><th>Tyre</th><th>Fuel</th></tr>${rows}</table>`
    }
  }

  if (race.cars.length) {
    const rows = race.cars
      .map(
        (c) => `<tr class="${c.isPlayer ? 'me' : ''}"><td>${c.position}</td><td>${esc(c.name)}</td>
          <td>${c.position === 1 ? '' : formatDelta(c.deltaToCarInFrontMs)}</td><td>${formatLapTime(c.lastLapMs)}</td>
          <td>${esc(c.tyreVisual ?? '')} ${c.tyreAgeLaps ?? ''}</td><td>${c.numPitStops}</td></tr>`,
      )
      .join('')
    $('order').innerHTML =
      `<h2>Order</h2><table><tr><th>P</th><th>Driver</th><th>Gap</th><th>Last</th><th>Tyre</th><th>Stops</th></tr>${rows}</table>`
  }

  const rejected = Object.entries(listener.rejected)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')
  $('diag').innerHTML =
    `<h2>Listener</h2><div class="muted">UDP 0.0.0.0:${listener.port} · received ${listener.received} · parsed ${listener.parsed}${rejected ? ` · rejected ${esc(rejected)}` : ''}${recording.path ? `<br>recording: ${esc(recording.path)}` : ''}</div>`
}

window.gp.onSnapshot(render)
$('rec').addEventListener('click', () => void window.gp.toggleRecording())
$('ontop').addEventListener('click', async () => {
  const on = await window.gp.toggleOnTop()
  $('ontop').classList.toggle('on', on)
})

const player = new RadioPlayer()
window.gp.onAudio((m) => player.handle(m))

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
            `<div class="note"><span class="k">${esc(n.category)}${n.track ? `: ${esc(n.track)}` : ''}</span><span class="t">${esc(n.text)}${n.source === 'engineer' ? ' <span class="muted">(GP)</span>' : ''}</span><button data-id="${esc(n.id)}">x</button></div>`,
        )
        .join('')
    : 'Nothing yet.'
  $('sessions').innerHTML = d.sessions.length
    ? d.sessions
        .map(
          (x) =>
            `<div class="sess"><div>${esc(x.date)} · ${esc(x.track)} ${esc(x.type)} <span class="muted">(${x.program === 'career' ? 'career' : 'sim'}, ${esc(x.mode)})</span> · best ${esc(x.best ?? '-')}${x.result ? ` · ${esc(x.result)}` : ''}</div>${x.summary ? `<div class="muted">${esc(x.summary)}</div>` : ''}</div>`,
        )
        .join('')
    : 'No sessions yet.'
}

let notesOpen = false
$('tab').addEventListener('click', async () => {
  notesOpen = !notesOpen
  $('notesView').classList.toggle('hidden', !notesOpen)
  $('raceView').classList.toggle('hidden', notesOpen)
  $('tab').textContent = notesOpen ? 'Race' : 'Notes'
  if (notesOpen) renderNotes(await window.gp.notes())
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
  const track = ($('noteTrack') as HTMLInputElement).value.trim()
  renderNotes(await window.gp.addNote({ category, text, ...(track ? { track } : {}) }))
  ;($('noteText') as HTMLInputElement).value = ''
})
$('notesList').addEventListener('click', async (e) => {
  const id = (e.target as HTMLElement).dataset.id
  if (id) renderNotes(await window.gp.removeNote(id))
})
