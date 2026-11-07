#!/usr/bin/env -S npx tsx
import dgram from 'node:dgram'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'
import { EngineerSession, NotesStore, attachHistory, attachRadio } from '@gp/engineer'
import { HistoryDb, backfill, ingestRecording } from '@gp/history'
import { formatLapTime } from '@gp/shared'
import {
  DEFAULT_PORT,
  PacketId,
  RaceState,
  RecordingWriter,
  TelemetryListener,
  parsePacket,
  readRecording,
  readRecordingMeta,
  replayRecording,
} from '@gp/telemetry'
import {
  CornerGate,
  DeepgramStt,
  DualSensePtt,
  F1_TERMS,
  Mic,
  WhisperStt,
  fixDriverNames,
  gpHome,
  loadDotEnv,
} from '@gp/voice'
import HID from 'node-hid'

const USAGE = `gp <command> [options]

  record  [--out file.gprec] [--port 20777] [--note "text"]
          Listen for F1 23 telemetry and save raw packets. Ctrl+C to stop.
  replay  <file.gprec> [--speed 1] [--to 127.0.0.1:20777] [--loop]
          Send a recording over UDP as if the game were running.
  inspect <file.gprec>
          Summarise a recording: duration, packet counts, sessions, player laps.
  live    [--port 20777]
          Print a compact live view of the race state.
  chat    [--replay file.gprec [--speed 1] [--until 600]] [--port 20777] [--db gp.db]
          [--model sonnet] [--check-model haiku] [--no-radio]
          Talk to the engineer in the terminal, against live telemetry or a recording.
          --until replays up to that many seconds as fast as possible, then freezes there.
          Needs a Claude Code login on this machine (claude /login).
  ingest  [file.gprec... | dir] [--db ~/Documents/GP/gp.db]
          Read recordings into the history database (default: every new one in
          ~/Documents/GP/recordings). Never deletes anything.
  history [--db ~/Documents/GP/gp.db] [--last 20]
          List the sessions GP remembers.
  gate-test <file.gprec>
          How often GP would be allowed to talk (on a straight) over a recording.
  ptt-test [--raw]
          Hold the push-to-talk button (L3 by default, GP_PTT_BUTTON=l3|r3|mute), talk, release: prints what was heard and how
          long transcription took. --raw prints which HID report bytes change instead.
`

// pnpm runs scripts from the package dir; resolve user paths against where they ran pnpm.
const cwd = process.env.INIT_CWD ?? process.cwd()
const [command, ...rest] = process.argv.slice(2)

const { values, positionals } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    port: { type: 'string' },
    note: { type: 'string' },
    speed: { type: 'string' },
    to: { type: 'string' },
    loop: { type: 'boolean' },
    replay: { type: 'string' },
    until: { type: 'string' },
    model: { type: 'string' },
    'check-model': { type: 'string' },
    'no-radio': { type: 'boolean' },
    raw: { type: 'boolean' },
    db: { type: 'string' },
    last: { type: 'string' },
  },
})
const port = values.port ? Number(values.port) : DEFAULT_PORT

switch (command) {
  case 'record':
    await record()
    break
  case 'replay':
    await replay()
    break
  case 'inspect':
    await inspect()
    break
  case 'live':
    await live()
    break
  case 'chat':
    await chat()
    break
  case 'ptt-test':
    await pttTest()
    break
  case 'ingest':
    await ingest()
    break
  case 'history':
    showHistory()
    break
  case 'gate-test':
    await gateTest()
    break
  default:
    process.stdout.write(USAGE)
    process.exit(command ? 1 : 0)
}

async function record(): Promise<void> {
  const out = values.out
    ? resolve(cwd, values.out)
    : join(cwd, 'recordings', `${new Date().toISOString().replace(/[:.]/g, '-')}.gprec`)
  mkdirSync(join(out, '..'), { recursive: true })
  const writer = new RecordingWriter(out, values.note ? { note: values.note } : {})
  const listener = new TelemetryListener({ port })
  const state = new RaceState()
  listener.on('raw', ({ buf, at }) => writer.write(buf, at))
  listener.on('packet', (p) => state.ingest(p))
  state.on('lapCompleted', (l) => {
    if (l.isPlayer)
      console.log(
        `  lap ${l.lapNumber}: ${formatLapTime(l.lapTimeMs)}${l.valid ? '' : ' (invalid)'}`,
      )
  })
  await listener.start()
  console.log(`recording UDP :${port} -> ${out}`)
  const timer = setInterval(() => {
    const s = state.snapshot()
    const mb = (writer.bytes / 1e6).toFixed(1)
    console.log(
      `[${s.status}] ${s.packetsPerSecond} pkt/s, ${writer.count} packets, ${mb} MB${s.session ? `, ${s.session.track} ${s.session.sessionType}` : ''}`,
    )
  }, 2000)
  await new Promise<void>((done) => process.once('SIGINT', () => done()))
  clearInterval(timer)
  await listener.stop()
  await writer.close()
  console.log(`\nsaved ${writer.count} packets to ${out}`)
}

async function replay(): Promise<void> {
  const file = positionals[0]
  if (!file) throw new Error('replay needs a .gprec file')
  const path = resolve(cwd, file)
  const [host, p] = (values.to ?? `127.0.0.1:${DEFAULT_PORT}`).split(':')
  const target = { host: host ?? '127.0.0.1', port: Number(p ?? DEFAULT_PORT) }
  const speed = values.speed === 'max' ? Number.POSITIVE_INFINITY : Number(values.speed ?? 1)
  const socket = dgram.createSocket('udp4')
  const ac = new AbortController()
  process.once('SIGINT', () => ac.abort())
  console.log(`replaying ${path} -> ${target.host}:${target.port} at ${speed}x`)
  do {
    let n = 0
    for await (const pkt of replayRecording(path, { speed, signal: ac.signal })) {
      socket.send(pkt.buf, target.port, target.host)
      n++
      // At max speed, yield occasionally so the socket can flush.
      if (!Number.isFinite(speed) && n % 200 === 0) await new Promise((r) => setImmediate(r))
    }
    console.log(`sent ${n} packets`)
  } while (values.loop && !ac.signal.aborted)
  socket.close()
}

async function inspect(): Promise<void> {
  const file = positionals[0]
  if (!file) throw new Error('inspect needs a .gprec file')
  const path = resolve(cwd, file)
  const meta = await readRecordingMeta(path)
  let clock = 0
  const state = new RaceState({ now: () => clock })
  const counts = new Map<number, number>()
  const rejected = new Map<string, number>()
  const sessions: { uid: string; startedAt: number; label: string; laps: string[] }[] = []
  state.on('sessionStarted', ({ uid }) =>
    sessions.push({ uid, startedAt: clock, label: '', laps: [] }),
  )
  state.on('lapCompleted', (l) => {
    if (l.isPlayer)
      sessions
        .at(-1)
        ?.laps.push(
          `  lap ${String(l.lapNumber).padStart(2)}  ${formatLapTime(l.lapTimeMs)}  ` +
            `S1 ${formatLapTime(l.sector1Ms)} S2 ${formatLapTime(l.sector2Ms)} S3 ${formatLapTime(l.sector3Ms)}` +
            `  ${l.tyreVisual ?? '?'} (${l.tyreAgeLaps ?? '?'} laps)${l.valid ? '' : '  INVALID'}`,
        )
  })
  let total = 0
  let duration = 0
  for await (const pkt of readRecording(path)) {
    total++
    clock = pkt.t
    duration = pkt.t
    const res = parsePacket(pkt.buf)
    if (!res.ok) {
      rejected.set(res.reason, (rejected.get(res.reason) ?? 0) + 1)
      continue
    }
    counts.set(res.packet.id, (counts.get(res.packet.id) ?? 0) + 1)
    state.ingest(res.packet)
  }
  const s = state.snapshot()
  console.log(`${path}`)
  console.log(`recorded ${meta.createdAt}${meta.note ? ` (${meta.note})` : ''}`)
  console.log(`${total} packets over ${(duration / 1000).toFixed(1)}s`)
  for (const [id, n] of [...counts].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${String(id).padStart(2)} ${PacketId[id]?.padEnd(20)} ${n}`)
  }
  if (rejected.size) console.log('rejected:', Object.fromEntries(rejected))
  console.log(`sessions: ${sessions.length}`)
  for (const [n, sess] of sessions.entries()) {
    const start = (sess.startedAt / 1000).toFixed(0)
    console.log(
      `\nsession ${n + 1} (uid ${sess.uid}, from ${start}s): ${sess.laps.length} player laps`,
    )
    if (sess.laps.length) console.log(sess.laps.join('\n'))
  }
  if (s.session)
    console.log(`\nlast session: ${s.session.track} ${s.session.sessionType}, ${s.session.weather}`)
}

async function live(): Promise<void> {
  const listener = new TelemetryListener({ port })
  const state = new RaceState()
  listener.on('packet', (p) => state.ingest(p))
  await listener.start()
  setInterval(() => {
    const s = state.snapshot()
    const p = s.player
    const me = s.cars.find((c) => c.isPlayer)
    const lines = [
      `status ${s.status}  ${s.packetsPerSecond} pkt/s`,
      s.session
        ? `${s.session.track} ${s.session.sessionType}  ${s.session.weather}  track ${s.session.trackTempC}C  SC: ${s.session.safetyCar}`
        : 'no session',
    ]
    if (p && me) {
      const wear = p.tyreWear.map((w) => w.toFixed(0)).join('/')
      lines.push(
        `P${me.position}  lap ${me.currentLap}  last ${formatLapTime(me.lastLapMs)}  best ${formatLapTime(p.bestLapMs)}  current ${formatLapTime(me.currentLapMs)}${p.lapInvalid ? ' (invalid)' : ''}`,
        `${p.speedKph} km/h  gear ${p.gear}  thr ${(p.throttle * 100).toFixed(0)}%  brk ${(p.brake * 100).toFixed(0)}%`,
        `tyres ${me.tyreVisual ?? '?'} ${me.tyreAgeLaps ?? '?'} laps, wear RL/RR/FL/FR ${wear}%  fuel ${p.fuelKg.toFixed(1)}kg (${p.fuelMarginLaps >= 0 ? '+' : ''}${p.fuelMarginLaps.toFixed(1)} laps margin)  ERS ${p.ersPercent.toFixed(0)}%`,
      )
    }
    process.stdout.write(`\x1b[2J\x1b[H${lines.join('\n')}\n`)
  }, 250)
  await new Promise<void>((done) => process.once('SIGINT', () => done()))
  await listener.stop()
}

async function chat(): Promise<void> {
  const gpHome = process.env.GP_HOME ?? join(homedir(), 'Documents', 'GP')
  const engineerCwd = join(gpHome, 'engineer')
  mkdirSync(engineerCwd, { recursive: true })
  const notes = new NotesStore(join(gpHome, 'notes.json'))

  // In replay mode the state's clock follows the recording, so "live/paused" match the race.
  let recClock = 0
  let recWall = Date.now()
  let frozen = false
  const replayFile = values.replay ? resolve(cwd, values.replay) : null
  const state = replayFile
    ? new RaceState({ now: () => recClock + (frozen ? 0 : Date.now() - recWall) })
    : new RaceState()

  const history = historyDb()
  const engineer = new EngineerSession({
    snapshot: () => state.snapshot(),
    notes,
    history,
    cwd: engineerCwd,
    ...(values.model ? { model: values.model } : {}),
    ...(values['check-model'] ? { checkModel: values['check-model'] } : {}),
  })

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'you> ' })
  let rlClosed = false
  rl.on('close', () => {
    rlClosed = true
  })
  const say = (line: string) => {
    if (rlClosed) return
    // Print above the prompt without clobbering what the driver is typing.
    process.stdout.write(`\r\x1b[2K${line}\n`)
    rl.prompt(true)
  }

  let streaming = false
  engineer.on('delta', ({ kind, text }) => {
    if (kind !== 'ask') return
    if (!streaming) {
      process.stdout.write('\x1b[33mGP>\x1b[0m ')
      streaming = true
    }
    process.stdout.write(text)
  })
  engineer.on('tool', ({ kind, name }) => {
    if (kind === 'ask' && process.env.GP_DEBUG)
      say(`  \x1b[2m[${name.replace('mcp__race__', '')}]\x1b[0m`)
  })
  engineer.on('error', (e) => say(`engineer error: ${e.message}`))

  let stopRadio: (() => void) | null = null
  if (!values['no-radio']) {
    const hooks = attachHistory(state, history, (t) => engineer.addContext(t))
    stopRadio = attachRadio(state, engineer, {
      lapNote: hooks.lapNote,
      onCall: (r) =>
        say(`\x1b[36mGP (radio)>\x1b[0m ${r.text}  \x1b[2m(${r.model}, ${r.totalMs}ms)\x1b[0m`),
    })
  }

  let listener: TelemetryListener | null = null
  const ac = new AbortController()
  if (replayFile) {
    const until = values.until ? Number(values.until) * 1000 : null
    const speed = until !== null ? Number.POSITIVE_INFINITY : Number(values.speed ?? 1)
    console.log(
      `replaying ${replayFile}${until !== null ? ` up to ${until / 1000}s` : ` at ${speed}x`}`,
    )
    void (async () => {
      let n = 0
      for await (const pkt of replayRecording(replayFile, { speed, signal: ac.signal })) {
        if (until !== null && pkt.t > until) break
        recClock = pkt.t
        recWall = Date.now()
        const res = parsePacket(pkt.buf)
        if (res.ok) state.ingest(res.packet)
        if (!Number.isFinite(speed) && ++n % 2000 === 0) await new Promise((r) => setImmediate(r))
      }
      if (until !== null) {
        frozen = true
        state.tick()
        say(`(frozen at ${(recClock / 1000).toFixed(0)}s: ${statusLine()})`)
      } else say('(recording finished)')
    })()
  } else {
    listener = new TelemetryListener({ port })
    listener.on('packet', (p) => state.ingest(p))
    await listener.start()
    console.log(`listening for F1 23 telemetry on UDP :${port}`)
  }

  function statusLine(): string {
    const s = state.snapshot()
    const me = s.cars.find((c) => c.isPlayer)
    return [
      s.status,
      s.session ? `${s.session.track} ${s.session.sessionType}` : 'no session',
      me ? `lap ${me.currentLap} P${me.position}` : '',
    ]
      .filter(Boolean)
      .join(' · ')
  }

  console.log(
    'Type to talk to GP. /status shows the race state, /notes lists his notes, /quit exits.',
  )
  engineer.start()
  rl.prompt()
  let busy = false
  for await (const line of rl) {
    const text = line.trim()
    if (!text) {
      rl.prompt()
      continue
    }
    if (text === '/quit') break
    if (text === '/status') {
      say(statusLine())
      continue
    }
    if (text === '/notes') {
      const all = notes.all()
      say(
        all.length
          ? all.map((n) => `  ${n.id} [${n.category}] ${n.text}`).join('\n')
          : '  (no notes yet)',
      )
      continue
    }
    if (busy) {
      say('(still answering, hang on)')
      continue
    }
    busy = true
    streaming = false
    engineer
      .ask(text)
      .then((r) => {
        if (!streaming) process.stdout.write(`\x1b[33mGP>\x1b[0m ${r.text}`)
        process.stdout.write(
          `\n\x1b[2m(${r.model}, first words ${r.firstTextMs ?? '-'}ms, total ${r.totalMs}ms${r.toolCalls.length ? `, tools: ${r.toolCalls.map((t) => t.replace('mcp__race__', '')).join(', ')}` : ''})\x1b[0m\n`,
        )
      })
      .catch((e: Error) => say(`error: ${e.message}`))
      .finally(() => {
        busy = false
        streaming = false
        if (!rlClosed) rl.prompt()
      })
  }
  ac.abort()
  stopRadio?.()
  rl.close()
  await listener?.stop()
  await engineer.close()
  process.exit(0)
}

async function pttTest(): Promise<void> {
  if (values.raw) {
    const info = HID.devices().find((d) => d.vendorId === 0x054c && d.path)
    if (!info?.path) throw new Error('no DualSense found')
    console.log(
      `${info.product} ${info.path}. Press buttons; changed bytes are printed. Ctrl+C to stop.`,
    )
    const dev = new HID.HID(info.path, { nonExclusive: true })
    let prev: Buffer | null = null
    dev.on('data', (d: Buffer) => {
      // Skip sticks/triggers/motion: only print bytes 8-11 (buttons on USB and Bluetooth).
      if (prev)
        for (let i = 8; i <= 11; i++)
          if (d[i] !== prev[i])
            console.log(
              `report 0x${d[0]!.toString(16)} len ${d.length} byte ${i}: 0x${prev[i]!.toString(16)} -> 0x${d[i]!.toString(16)}`,
            )
      prev = Buffer.from(d)
    })
    await new Promise<void>((done) => process.once('SIGINT', () => done()))
    dev.close()
    return
  }
  const env = loadDotEnv()
  console.log(env ? `keys from ${env}` : `no ${join(gpHome(), '.env')}, using local whisper`)
  const whisper = new WhisperStt()
  const stt = process.env.DEEPGRAM_API_KEY ? new DeepgramStt(process.env.DEEPGRAM_API_KEY) : whisper
  if (stt === whisper && !whisper.available)
    console.log('whisper model missing: put ggml-base.en.bin in ~/Documents/GP/models')
  const grid = [
    'VERSTAPPEN',
    'PÉREZ',
    'HAMILTON',
    'RUSSELL',
    'LECLERC',
    'SAINZ',
    'NORRIS',
    'PIASTRI',
    'ALONSO',
    'STROLL',
    'GASLY',
    'OCON',
    'ALBON',
    'SARGEANT',
    'TSUNODA',
    'DE VRIES',
    'BOTTAS',
    'ZHOU',
    'MAGNUSSEN',
    'HÜLKENBERG',
  ]
  const mic = new Mic()
  mic.on('error', (e) => console.error(`mic: ${e.message}`))
  mic.start()
  const ptt = new DualSensePtt()
  ptt.on('connected', ({ transport }) => console.log(`controller connected (${transport})`))
  ptt.on('error', (e) => console.error(`ptt: ${e.message}`))
  let stream: ReturnType<typeof stt.open> | null = null
  ptt.on('down', () => {
    process.stdout.write('[talking] ')
    stream = stt.open([...grid, ...F1_TERMS])
    const s = stream
    mic.begin((pcm) => s.write(pcm))
  })
  ptt.on('up', async () => {
    const s = stream
    stream = null
    if (!s) return
    const pcm = mic.end()
    const t0 = performance.now()
    const raw = await s.finish().catch((e: Error) => `(error: ${e.message})`)
    const ms = Math.round(performance.now() - t0)
    console.log(`${stt.name}, ${(pcm.length / 32000).toFixed(1)}s audio, ${ms}ms after release`)
    console.log(`  heard: "${raw}"`)
    console.log(`  fixed: "${fixDriverNames(raw, grid)}"`)
  })
  ptt.start()
  console.log(`stt: ${stt.name}. Hold ${ptt.button} on the DualSense and talk. Ctrl+C to stop.`)
  await new Promise<void>((done) => process.once('SIGINT', () => done()))
  ptt.stop()
  mic.stop()
}

async function gateTest(): Promise<void> {
  const path = process.argv[3]
  if (!path) throw new Error('usage: gate-test <file.gprec>')
  let clock = 0
  const state = new RaceState({ now: () => clock })
  const gate = new CornerGate({ now: () => clock })
  let lastSample = 0
  let driving = 0
  let open = 0
  let windowStart: number | null = null
  const windows: number[] = []
  for await (const pkt of readRecording(path)) {
    clock = pkt.t
    const res = parsePacket(pkt.buf)
    if (!res.ok) continue
    state.ingest(res.packet)
    if (clock - lastSample < 50) continue
    lastSample = clock
    const inputs = state.playerInputs()
    if (!inputs || inputs.speedKph < 50) continue
    driving += 50
    const ok = gate.update(inputs)
    if (ok) {
      open += 50
      windowStart ??= clock
    } else if (windowStart !== null) {
      windows.push(clock - windowStart)
      windowStart = null
    }
  }
  const pct = driving ? ((open / driving) * 100).toFixed(1) : '0'
  const long = windows.filter((w) => w >= 2000).length
  const top = [...windows]
    .sort((a, b) => b - a)
    .slice(0, 5)
    .map((w) => `${(w / 1000).toFixed(1)}s`)
  console.log(`driving ${(driving / 1000).toFixed(0)}s, clear to talk ${pct}%`)
  console.log(`${windows.length} windows, ${long} of 2s+, longest ${top.join(' ')}`)
}

function historyDb(): HistoryDb {
  return new HistoryDb(values.db ? resolve(cwd, values.db) : join(gpHome(), 'gp.db'))
}

async function ingest(): Promise<void> {
  const db = historyDb()
  const targets = positionals.length
    ? positionals.map((p) => resolve(cwd, p))
    : [join(gpHome(), 'recordings')]
  for (const target of targets) {
    if (target.endsWith('.gprec')) {
      const r = await ingestRecording(db, target)
      console.log(`${r.file}: ${r.error ?? `${r.sessions.length} session(s)`}`)
    } else {
      const rs = await backfill(db, target, {
        onResult: (r) => console.log(`${r.file}: ${r.error ?? `${r.sessions.length} session(s)`}`),
      })
      console.log(`${target}: ${rs.length} new recording(s)`)
    }
  }
  db.close()
}

function showHistory(): void {
  const db = historyDb()
  for (const s of db.recentSessions(Number(values.last ?? 20)).reverse()) {
    const best = s.best_lap_ms ? formatLapTime(s.best_lap_ms) : '-'
    const result = s.finish_pos ? ` P${s.finish_pos} from P${s.grid_pos}` : ''
    console.log(
      `${s.started_at.slice(0, 16)}  ${s.program.padEnd(6)} ${s.track} ${s.session_type} (${s.mode}): ${s.laps_done} laps, best ${best}${result}`,
    )
  }
  db.close()
}
