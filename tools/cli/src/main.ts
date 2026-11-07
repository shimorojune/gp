#!/usr/bin/env -S npx tsx
import dgram from 'node:dgram'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
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

const USAGE = `gp <command> [options]

  record  [--out file.gprec] [--port 20777] [--note "text"]
          Listen for F1 23 telemetry and save raw packets. Ctrl+C to stop.
  replay  <file.gprec> [--speed 1] [--to 127.0.0.1:20777] [--loop]
          Send a recording over UDP as if the game were running.
  inspect <file.gprec>
          Summarise a recording: duration, packet counts, sessions, player laps.
  live    [--port 20777]
          Print a compact live view of the race state.
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
  const sessions: string[] = []
  const laps: string[] = []
  state.on('sessionStarted', ({ uid }) => sessions.push(uid))
  state.on('lapCompleted', (l) => {
    if (l.isPlayer)
      laps.push(
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
  if (s.session)
    console.log(`last session: ${s.session.track} ${s.session.sessionType}, ${s.session.weather}`)
  if (laps.length) console.log(`player laps:\n${laps.join('\n')}`)
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
        `tyres ${me.tyreVisual ?? '?'} ${me.tyreAgeLaps ?? '?'} laps, wear RL/RR/FL/FR ${wear}%  fuel ${p.fuelKg.toFixed(1)}kg (${p.fuelRemainingLaps.toFixed(1)} laps)  ERS ${p.ersPercent.toFixed(0)}%`,
      )
    }
    process.stdout.write(`\x1b[2J\x1b[H${lines.join('\n')}\n`)
  }, 250)
  await new Promise<void>((done) => process.once('SIGINT', () => done()))
  await listener.stop()
}
