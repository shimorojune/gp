import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  EngineerSession,
  type NoteCategory,
  NotesStore,
  attachHistory,
  attachRadio,
  debriefSession,
} from '@gp/engineer'
import {
  HistoryDb,
  SessionCollector,
  backfill,
  ingestRecording,
  pruneRecordings,
  recentSessionsView,
} from '@gp/history'
import { DEFAULT_PORT, RaceState, RecordingWriter, TelemetryListener } from '@gp/telemetry'
import { gpHome, loadDotEnv } from '@gp/voice'
import { BrowserWindow, app, globalShortcut, ipcMain } from 'electron'
import {
  type AudioMessage,
  type ChatEvent,
  IPC,
  type NotesData,
  type RecordingState,
  type SnapshotMessage,
} from '../ipc.ts'
import { RadioVoice } from './voice.ts'

const PORT = Number(process.env.GP_UDP_PORT ?? DEFAULT_PORT)
const GP_HOME = gpHome()
// API keys (Deepgram, ElevenLabs) live in ~/Documents/GP/.env, nowhere else.
const envFile = loadDotEnv(GP_HOME)
const RECORDINGS_DIR = process.env.GP_RECORDINGS_DIR ?? join(GP_HOME, 'recordings')
/** Toggles the chat overlay. */
const CHAT_HOTKEY = process.env.GP_CHAT_HOTKEY ?? 'CommandOrControl+Shift+G'
/** Keyboard push-to-talk fallback (press to talk, press again to send). Main PTT is the DualSense mute button. */
const TALK_HOTKEY = process.env.GP_TALK_HOTKEY ?? 'CommandOrControl+Shift+T'

/** Raw recordings kept on disk once they're in the history database (~400 MB per race). */
const KEEP_RECORDINGS = Number(process.env.GP_KEEP_RECORDINGS ?? 10)
const history = new HistoryDb(join(GP_HOME, 'gp.db'))
/** Live copy of what the history will record, for corner comparisons during the session. */
const liveStart = Date.now()
const live = new SessionCollector(liveStart)

const listener = new TelemetryListener({ port: PORT })
const state = new RaceState()
let writer: RecordingWriter | null = null
let writerPath: string | null = null
let win: BrowserWindow | null = null
let chatWin: BrowserWindow | null = null

const notes = new NotesStore(join(GP_HOME, 'notes.json'))
const engineerCwd = join(GP_HOME, 'engineer')
mkdirSync(engineerCwd, { recursive: true })
const engineer = new EngineerSession({
  snapshot: () => state.snapshot(),
  notes,
  history,
  liveBest: () => live.liveBest(),
  liveLaps: () => live.live(),
  cwd: engineerCwd,
  ...(process.env.GP_MODEL ? { model: process.env.GP_MODEL } : {}),
  ...(process.env.GP_CHECK_MODEL ? { checkModel: process.env.GP_CHECK_MODEL } : {}),
})
const toChat = (e: ChatEvent) => chatWin?.webContents.send(IPC.chatEvent, e)
const toAudio = (m: AudioMessage) => win?.webContents.send(IPC.audio, m)
const voice = new RadioVoice({ engineer, state, toAudio, toChat, log: (l) => console.log(l) })
engineer.on('delta', ({ id, kind, text }) => {
  if (kind === 'ask') toChat({ type: 'delta', id, text })
})
engineer.on('error', (e) => {
  console.error(`[engineer] error: ${e.message}`)
  toChat({ type: 'error', message: e.message })
})
engineer.on('turn', (t) => console.log(`[engineer] ${t.phase} #${t.id} ${t.kind} ${t.detail}`))
const historyHooks = attachHistory(state, history, (t) => engineer.addContext(t), {
  liveLaps: () => live.live(),
  onNewWeekend: () => {
    console.log('[engineer] new race weekend: fresh conversation')
    void engineer.restart().catch((e) => console.error('[engineer] restart failed', e))
  },
})
attachRadio(state, engineer, {
  lapNote: historyHooks.lapNote,
  locate: historyHooks.locate,
  onCall: (r, { urgent }) => {
    toChat({ type: 'radio', text: r.text, model: r.model })
    voice.radioCall(r.text, urgent)
    console.log(`[radio] ${r.text}`)
  },
  onPositionChange: (from, to) => {
    console.log(`[radio] position P${from} -> P${to}`)
    voice.positionChanged()
  },
})

listener.on('packet', (p) => {
  // Live collector first, so a lap event already sees that lap (setup check on the radio).
  live.feed(p, Date.now() - liveStart)
  state.ingest(p)
})
// Record every session automatically (one file per session) unless GP_AUTO_RECORD=0 or the
// driver switched recording off in the dashboard.
let autoRecord = process.env.GP_AUTO_RECORD !== '0'
listener.on('raw', ({ buf, at }) => {
  if (!writer && autoRecord) startRecording()
  writer?.write(buf, at)
})
state.on('sessionStarted', () => {
  // The first packets of the app run start a file and a session at the same moment.
  if (!writer || !autoRecord || writer.count < 100) return
  void closeRecording()
  startRecording()
})
listener.on('error', (err) => console.error('[udp]', err))
state.on('lapCompleted', (l) => {
  if (l.isPlayer) console.log(`[lap] ${l.lapNumber} ${l.lapTimeMs}ms valid=${l.valid}`)
})

function recordingState(): RecordingState {
  return { recording: writer !== null, path: writerPath, packets: writer?.count ?? 0 }
}

function startRecording(): void {
  mkdirSync(RECORDINGS_DIR, { recursive: true })
  writerPath = join(RECORDINGS_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}.gprec`)
  writer = new RecordingWriter(writerPath)
  console.log(`[rec] recording to ${writerPath}`)
}

/** Serial queue: one recording read at a time, in the background. */
let historyQueue: Promise<unknown> = Promise.resolve()
function queueHistory(job: () => Promise<void>): void {
  historyQueue = historyQueue.then(job).catch((e) => console.error('[history]', e))
}

function afterIngest(): void {
  if (!Number.isFinite(KEEP_RECORDINGS) || KEEP_RECORDINGS <= 0) return
  const gone = pruneRecordings(history, RECORDINGS_DIR, KEEP_RECORDINGS, writerPath)
  if (gone.length)
    console.log(`[history] deleted ${gone.length} old raw recording(s): ${gone.join(', ')}`)
}

/** Summary for the records and an updated driver profile, by the cheap model. */
async function debrief(ids: number[]): Promise<void> {
  for (const id of ids) {
    try {
      const d = await debriefSession(history, id, { cwd: engineerCwd })
      if (!d) continue
      console.log(`[history] debrief #${id}: ${d.summary}`)
      engineer.addContext(`Session debrief saved: ${d.summary} Updated profile: ${d.profile}`)
    } catch (e) {
      console.error(`[history] debrief #${id} failed:`, e instanceof Error ? e.message : e)
    }
  }
}

function logIngest(r: Awaited<ReturnType<typeof ingestRecording>>): void {
  if (r.error) console.error(`[history] ${r.file}: ${r.error}`)
  else
    console.log(
      `[history] ${r.file}: ${r.sessions.map((s) => `${s.track} ${s.sessionType} (${s.mode}, ${s.laps.length} laps)`).join('; ') || 'nothing driven'}`,
    )
}

/** Close the current recording and save its sessions to the history database. */
async function closeRecording(): Promise<void> {
  const w = writer
  const path = writerPath
  writer = null
  if (!w) return
  await w.close()
  if (path)
    queueHistory(async () => {
      const r = await ingestRecording(history, path)
      logIngest(r)
      afterIngest()
      await debrief(r.ids)
    })
}

async function toggleRecording(): Promise<RecordingState> {
  if (writer) {
    autoRecord = false
    await closeRecording()
  } else {
    autoRecord = true
    startRecording()
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
      // This window plays GP's voice; keep audio timing tight when it's in the background.
      backgroundThrottling: false,
    },
  })
  win.loadFile(join(__dirname, 'renderer', 'index.html'))
  // The dashboard plays GP's voice; get its console and crashes into the app log.
  win.webContents.on('console-message', (e) => {
    if (e.level !== 'debug') console.log(`[renderer] ${e.message}`)
  })
  win.webContents.on('render-process-gone', (_e, d) =>
    console.error(`[renderer] gone: ${d.reason}`),
  )
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
    // A non-activating NSPanel: floats over the fullscreen game and takes clicks and typing
    // without activating the app, so macOS doesn't switch out of the game's Space.
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  })
  // Float above a fullscreen game (CrossOver) and follow across Spaces.
  w.setAlwaysOnTop(true, 'screen-saver')
  // skipTransformProcessType: otherwise Electron turns the whole app into an accessory app on
  // macOS, which drops it from the Dock and Cmd+Tab.
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  w.loadFile(join(__dirname, 'renderer', 'chat.html'))
  w.on('closed', () => {
    chatWin = null
  })
  return w
}

function toggleChat(): void {
  chatWin ??= createChatWindow()
  // show()/focus() would activate the app and pull the driver out of the fullscreen game.
  // Show it inactive; click into it to type.
  if (chatWin.isVisible()) chatWin.hide()
  else chatWin.showInactive()
}

// A second copy would share UDP 20777 with the first and split the telemetry between them
// (each sees only some packets), so the radio calls silently go missing. One copy only.
if (!app.requestSingleInstanceLock()) {
  console.log('[main] GP is already running; quitting this copy')
  app.quit()
  process.exit(0)
}
app.on('second-instance', () => {
  win?.show()
  win?.focus()
})

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
  if (globalShortcut.register(TALK_HOTKEY, () => voice.toggleTalk()))
    console.log(`[voice] ${TALK_HOTKEY} = push-to-talk fallback (press, talk, press again)`)
  console.log(
    `[env] ${envFile ?? `no ${join(GP_HOME, '.env')} (no API keys: whisper + Mac voice)`}`,
  )

  // Notes tab: GP's profile of him, his notes, recent sessions. Edits reach GP as [context].
  const notesData = (): NotesData => ({
    profile: history.profile(),
    notes: notes.all().map(({ id, category, track, text, source }) => ({
      id,
      category,
      track,
      text,
      source,
    })),
    sessions: recentSessionsView(history, 15).map((r) => ({
      date: String(r.date),
      program: String(r.program),
      track: String(r.track),
      type: String(r.type),
      mode: String(r.mode),
      best: (r.best as string | null) ?? null,
      result: (r.result as string | null) ?? null,
      summary: (r.summary as string | null) ?? null,
    })),
  })
  ipcMain.handle(IPC.notesGet, () => notesData())
  ipcMain.handle(IPC.profileSave, (_e, text: string) => {
    history.setProfile(text, 'driver')
    engineer.addContext(`The driver edited your profile of him. It now reads: ${text.trim()}`)
    return notesData()
  })
  ipcMain.handle(IPC.noteAdd, (_e, n: { category: NoteCategory; text: string; track?: string }) => {
    const note = notes.add({
      category: n.category,
      text: n.text,
      source: 'driver',
      track: n.track ?? null,
    })
    engineer.addContext(`He added a note for you to remember (id ${note.id}): ${note.text}`)
    return notesData()
  })
  ipcMain.handle(IPC.noteRemove, (_e, id: string) => {
    if (notes.remove(id)) engineer.addContext(`He deleted note ${id}; forget it.`)
    return notesData()
  })

  ipcMain.handle(IPC.toggleRecording, () => toggleRecording())
  ipcMain.handle(IPC.toggleOnTop, () => {
    if (!win) return false
    win.setAlwaysOnTop(!win.isAlwaysOnTop(), 'floating')
    return win.isAlwaysOnTop()
  })

  await listener.start()
  console.log(`[udp] listening on 0.0.0.0:${PORT}`)
  // Recordings from earlier runs (or ones the app quit before reading) go into the history.
  queueHistory(async () => {
    const rs = await backfill(history, RECORDINGS_DIR, {
      skip: (p) => p === writerPath,
      onResult: logIngest,
    })
    afterIngest()
    await debrief(rs.flatMap((r) => r.ids))
  })
  createWindow()
  // Pre-create the overlay (hidden) and warm the engineer so the first answer is quick.
  chatWin = createChatWindow()
  engineer.start()
  voice.start()

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

process.on('uncaughtException', (e) => console.error('[main] uncaught', e))
process.on('unhandledRejection', (e) => console.error('[main] unhandled rejection', e))
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const)
  process.on(sig, () => {
    console.log(`[main] ${sig}, quitting`)
    app.quit()
  })
app.on('before-quit', () => console.log('[main] quitting'))

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  voice.stop()
})

app.on('window-all-closed', async () => {
  await engineer.close().catch(() => {})
  // Read at the next launch: don't hold up quitting for a few seconds of parsing.
  if (writer) await writer.close()
  await historyQueue
  history.close()
  await listener.stop()
  app.quit()
})
