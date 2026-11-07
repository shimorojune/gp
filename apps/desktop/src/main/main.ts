import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { EngineerSession, NotesStore, attachRadio } from '@gp/engineer'
import { DEFAULT_PORT, RaceState, RecordingWriter, TelemetryListener } from '@gp/telemetry'
import { BrowserWindow, app, globalShortcut, ipcMain } from 'electron'
import { type ChatEvent, IPC, type RecordingState, type SnapshotMessage } from '../ipc.ts'

const PORT = Number(process.env.GP_UDP_PORT ?? DEFAULT_PORT)
const GP_HOME = process.env.GP_HOME ?? join(homedir(), 'Documents', 'GP')
const RECORDINGS_DIR = process.env.GP_RECORDINGS_DIR ?? join(GP_HOME, 'recordings')
/** Toggles the chat overlay. Phase 3 adds the DualSense mic button for voice. */
const CHAT_HOTKEY = process.env.GP_CHAT_HOTKEY ?? 'CommandOrControl+Shift+G'

const listener = new TelemetryListener({ port: PORT })
const state = new RaceState()
let writer: RecordingWriter | null = null
let writerPath: string | null = null
let win: BrowserWindow | null = null
let chatWin: BrowserWindow | null = null

const engineerCwd = join(GP_HOME, 'engineer')
mkdirSync(engineerCwd, { recursive: true })
const engineer = new EngineerSession({
  snapshot: () => state.snapshot(),
  notes: new NotesStore(join(GP_HOME, 'notes.json')),
  cwd: engineerCwd,
  ...(process.env.GP_MODEL ? { model: process.env.GP_MODEL } : {}),
  ...(process.env.GP_CHECK_MODEL ? { checkModel: process.env.GP_CHECK_MODEL } : {}),
})
const toChat = (e: ChatEvent) => chatWin?.webContents.send(IPC.chatEvent, e)
engineer.on('delta', ({ id, kind, text }) => {
  if (kind === 'ask') toChat({ type: 'delta', id, text })
})
engineer.on('error', (e) => toChat({ type: 'error', message: e.message }))
attachRadio(state, engineer, {
  onCall: (r) => {
    toChat({ type: 'radio', text: r.text, model: r.model })
    console.log(`[radio] ${r.text}`)
  },
})

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
    // The hidden overlay would otherwise keep the app alive.
    chatWin?.destroy()
  })
}

function createChatWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 460,
    height: 380,
    title: 'GP radio',
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  })
  // Float above a fullscreen game (CrossOver) and follow across Spaces.
  w.setAlwaysOnTop(true, 'screen-saver')
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  w.loadFile(join(__dirname, 'renderer', 'chat.html'))
  w.on('closed', () => {
    chatWin = null
  })
  return w
}

function toggleChat(): void {
  chatWin ??= createChatWindow()
  if (chatWin.isVisible() && chatWin.isFocused()) chatWin.hide()
  else {
    chatWin.show()
    chatWin.focus()
  }
}

app.whenReady().then(async () => {
  ipcMain.handle(IPC.chatAsk, async (_e, text: string) => {
    try {
      const r = await engineer.ask(text)
      toChat({
        type: 'reply',
        id: r.id,
        text: r.text,
        model: r.model,
        firstTextMs: r.firstTextMs,
        totalMs: r.totalMs,
        tools: r.toolCalls.map((t) => t.replace('mcp__race__', '')),
      })
    } catch (err) {
      toChat({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  })
  ipcMain.on(IPC.chatHide, () => chatWin?.hide())
  if (!globalShortcut.register(CHAT_HOTKEY, toggleChat))
    console.error(`[chat] could not register hotkey ${CHAT_HOTKEY}`)
  else console.log(`[chat] ${CHAT_HOTKEY} toggles the GP radio overlay`)

  ipcMain.handle(IPC.toggleRecording, () => toggleRecording())
  ipcMain.handle(IPC.toggleOnTop, () => {
    if (!win) return false
    win.setAlwaysOnTop(!win.isAlwaysOnTop(), 'floating')
    return win.isAlwaysOnTop()
  })

  await listener.start()
  console.log(`[udp] listening on 0.0.0.0:${PORT}`)
  createWindow()
  // Pre-create the overlay (hidden) and warm the engineer so the first answer is quick.
  chatWin = createChatWindow()
  engineer.start()

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

app.on('will-quit', () => globalShortcut.unregisterAll())

app.on('window-all-closed', async () => {
  await engineer.close().catch(() => {})
  if (writer) await writer.close()
  await listener.stop()
  app.quit()
})
