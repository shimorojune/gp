import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PORT, RaceState, RecordingWriter, TelemetryListener } from '@gp/telemetry'
import { BrowserWindow, app, ipcMain } from 'electron'
import { IPC, type RecordingState, type SnapshotMessage } from '../ipc.ts'

const PORT = Number(process.env.GP_UDP_PORT ?? DEFAULT_PORT)
const RECORDINGS_DIR =
  process.env.GP_RECORDINGS_DIR ?? join(homedir(), 'Documents', 'GP', 'recordings')

const listener = new TelemetryListener({ port: PORT })
const state = new RaceState()
let writer: RecordingWriter | null = null
let writerPath: string | null = null
let win: BrowserWindow | null = null

listener.on('packet', (p) => state.ingest(p))
listener.on('raw', ({ buf, at }) => writer?.write(buf, at))
listener.on('error', (err) => console.error('[udp]', err))
state.on('lapCompleted', (l) => {
  if (l.isPlayer) console.log(`[lap] ${l.lapNumber} ${l.lapTimeMs}ms valid=${l.valid}`)
})

function recordingState(): RecordingState {
  return { recording: writer !== null, path: writerPath, packets: writer?.count ?? 0 }
}

async function toggleRecording(): Promise<RecordingState> {
  if (writer) {
    await writer.close()
    writer = null
  } else {
    mkdirSync(RECORDINGS_DIR, { recursive: true })
    writerPath = join(RECORDINGS_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}.gprec`)
    writer = new RecordingWriter(writerPath)
  }
  return recordingState()
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 640,
    height: 720,
    title: 'GP',
    backgroundColor: '#0d0f12',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  })
  win.loadFile(join(__dirname, 'renderer', 'index.html'))
  win.on('closed', () => {
    win = null
  })
}

app.whenReady().then(async () => {
  ipcMain.handle(IPC.toggleRecording, () => toggleRecording())
  ipcMain.handle(IPC.toggleOnTop, () => {
    if (!win) return false
    win.setAlwaysOnTop(!win.isAlwaysOnTop(), 'floating')
    return win.isAlwaysOnTop()
  })

  await listener.start()
  console.log(`[udp] listening on 0.0.0.0:${PORT}`)
  createWindow()

  // 10 Hz is plenty for a dashboard; the store itself ingests at full rate.
  setInterval(() => {
    state.tick()
    if (!win) return
    const msg: SnapshotMessage = {
      race: state.snapshot(),
      listener: {
        port: PORT,
        received: listener.stats.received,
        parsed: listener.stats.parsed,
        rejected: listener.stats.rejected as Record<string, number>,
      },
      recording: recordingState(),
    }
    win.webContents.send(IPC.snapshot, msg)
  }, 100)
})

app.on('window-all-closed', async () => {
  if (writer) await writer.close()
  await listener.stop()
  app.quit()
})
