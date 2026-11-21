import type { RaceSnapshot } from '@gp/telemetry'

export const IPC = {
  snapshot: 'gp:snapshot',
  toggleRecording: 'gp:toggle-recording',
  recordingState: 'gp:recording-state',
  toggleOnTop: 'gp:toggle-on-top',
  chatAsk: 'gp:chat-ask',
  chatEvent: 'gp:chat-event',
  chatHide: 'gp:chat-hide',
  audio: 'gp:audio',
  notesGet: 'gp:notes-get',
  profileSave: 'gp:profile-save',
  noteAdd: 'gp:note-add',
  noteRemove: 'gp:note-remove',
  appInfo: 'gp:app-info',
  updateState: 'gp:update-state',
  updateCheck: 'gp:update-check',
  updateInstall: 'gp:update-install',
  preflight: 'gp:preflight',
  saveKeys: 'gp:save-keys',
  relaunch: 'gp:relaunch',
  radioCard: 'gp:radio-card',
  radioDone: 'gp:radio-done',
  radioLevel: 'gp:radio-level',
  skinCss: 'gp:skin-css',
  secretsStatus: 'gp:secrets-status',
  secretsSave: 'gp:secrets-save',
  secretsTest: 'gp:secrets-test',
  secretsClear: 'gp:secrets-clear',
  status: 'gp:status',
} as const

export interface NoteItem {
  id: string
  category: string
  track: string | null
  text: string
  source: string
}

export interface SessionItem {
  date: string
  program: string
  track: string
  type: string
  mode: string
  best: string | null
  result: string | null
  summary: string | null
}

/** Everything the notes tab shows. */
export interface NotesData {
  profile: { text: string; updatedAt: string; editedBy: string } | null
  notes: NoteItem[]
  sessions: SessionItem[]
}

/** Speech for the dashboard window to play (it owns the Web Audio radio chain). */
export type AudioMessage =
  | { type: 'pcm'; utt: number; sampleRate: number; pcm: Uint8Array }
  /** No TTS key: speak with the Mac's built-in voice. */
  | { type: 'say'; utt: number; text: string; voice?: string }
  | { type: 'end'; utt: number }
  /** A breath between sentences. */
  | { type: 'gap'; utt: number; ms: number }
  /** Stop everything now (driver pressed push-to-talk). */
  | { type: 'stop' }
  | { type: 'beep'; kind: 'open' | 'close' }

/** Engineer output pushed to the chat overlay. */
export type ChatEvent =
  | { type: 'delta'; id: number; text: string }
  | {
      type: 'reply'
      id: number
      text: string
      model: string
      firstTextMs: number | null
      totalMs: number
      tools: string[]
    }
  | { type: 'radio'; text: string; model: string }
  /** What the driver said over push-to-talk, and how long transcription took. */
  | { type: 'heard'; text: string; stt: string; sttMs: number }
  | { type: 'voice'; status: string }
  | { type: 'error'; message: string }

/** Pushed to the overlay radio card window. */
export type RadioCardEvent =
  | {
      type: 'line'
      who: 'gp' | 'driver'
      text: string
      /** Your driver's name from the game, as it's shown on the card ('Team' before telemetry). */
      driver: string
      number: number | null
      teamId: number | null
    }
  /** GP's voice level, 0..1, while it plays (relayed from the dashboard's audio). */
  | { type: 'level'; level: number }

export interface RecordingState {
  recording: boolean
  path: string | null
  packets: number
}

export interface ListenerInfo {
  port: number
  received: number
  parsed: number
  rejected: Record<string, number>
}

export interface SnapshotMessage {
  race: RaceSnapshot
  listener: ListenerInfo
  recording: RecordingState
}

/** One line of the pre-flight check (main/preflight.ts). */
export interface PreflightCheck {
  id: string
  label: string
  status: 'ok' | 'warn' | 'fail'
  detail: string
}

export interface PreflightResult {
  checks: PreflightCheck[]
  /** No ~/Documents/GP/.env yet: show the setup form. */
  firstRun: boolean
}

/** Infisical connection as the settings pane edits it (main/secrets.ts). */
export interface InfisicalInput {
  siteUrl: string
  clientId: string
  /** Empty keeps the saved one. */
  clientSecret?: string
  projectId: string
  environment: string
  secretPath: string
}

export interface SecretsStatusInfo {
  configured: boolean
  source: 'infisical' | 'cache' | 'none'
  fetchedAt: string | null
  error: string | null
  /** Expected secret name -> present in the environment. Never the values. */
  found: Record<string, boolean>
  config: (Omit<InfisicalInput, 'clientSecret'> & { hasSecret: boolean }) | null
}

export type SecretsTestResult =
  | { found: Record<string, boolean>; count: number }
  | { error: string }

/** Live state for the status view: game, hardware, voice and connections. */
export interface StatusInfo {
  at: string
  game: {
    /** A packet arrived in the last 3 s. */
    receiving: boolean
    lastPacketAgoMs: number | null
    packetsPerSecond: number
    port: number
    mode: string | null
    track: string | null
    sessionType: string | null
  }
  recording: RecordingState
  mic: { permission: string; running: boolean }
  controller: { connected: boolean; transport: 'usb' | 'bluetooth' | null; pushToTalk: string }
  voice: { stt: string; sttFallbackReady: boolean; tts: string; speaking: boolean }
  secrets: SecretsStatusInfo
  /** Postgres sync. configured: DATABASE_URL is set and sync is running. */
  database: DatabaseInfo
}

export interface DatabaseInfo {
  configured: boolean
  lastSyncAt: string | null
  /** Sessions not yet in Postgres (or changed since). */
  pending: number
  oldestPendingAt: string | null
  pushed: number
  pulled: number
  error: string | null
}

export interface SetupKeys {
  deepgram?: string
  elevenlabs?: string
}

/** The self-updater (main/updater.ts). */
export interface UpdateState {
  phase:
    | 'disabled'
    | 'idle'
    | 'checking'
    | 'up-to-date'
    | 'downloading'
    | 'verifying'
    | 'ready'
    | 'installing'
    | 'error'
  current: string
  /** The new version, when there is one. */
  version?: string
  /** Download progress, 0-100. */
  progress?: number
  message?: string
  notes?: string
  checkedAt?: string
}

/** Which build is running. */
export interface AppInfo {
  version: string
  commit: string
  /** false when run from the repo with `pnpm desktop`. */
  packaged: boolean
}

/** "v1.2.0 (abc1234)", or "dev 1.2.0 (abc1234)" when run from the repo. */
export const versionLabel = (a: AppInfo) => `${a.packaged ? 'v' : 'dev '}${a.version} (${a.commit})`

/** What the preload script exposes on `window.gp`. */
export interface GpBridge {
  onSnapshot(cb: (msg: SnapshotMessage) => void): void
  toggleRecording(): Promise<RecordingState>
  toggleOnTop(): Promise<boolean>
  onAudio(cb: (m: AudioMessage) => void): void
  notes(): Promise<NotesData>
  saveProfile(text: string): Promise<NotesData>
  addNote(note: { category: string; text: string; track?: string }): Promise<NotesData>
  removeNote(id: string): Promise<NotesData>
  appInfo(): Promise<AppInfo>
  onUpdate(cb: (s: UpdateState) => void): void
  checkUpdate(): Promise<UpdateState>
  /** Quits and installs; resolves with a reason when it can't. */
  installUpdate(): Promise<string | null>
  preflight(): Promise<PreflightResult>
  /** Writes ~/Documents/GP/.env; GP needs a restart to use the keys. */
  saveKeys(keys: SetupKeys): Promise<{ file: string } | { error: string }>
  relaunch(): void
  /** GP's voice level while it plays, for the radio card's waveform. */
  radioLevel(level: number): void
  /** CSS for the local skin in ~/Documents/GP/skin ('' when there is none). */
  skinCss(): Promise<string>
  secretsStatus(): Promise<SecretsStatusInfo>
  /** Saves the connection and fetches again; resolves with an error message when saving fails. */
  saveSecrets(cfg: InfisicalInput): Promise<SecretsStatusInfo | { error: string }>
  testSecrets(cfg: InfisicalInput): Promise<SecretsTestResult>
  clearSecrets(): Promise<SecretsStatusInfo>
  status(): Promise<StatusInfo>
}

/** What the chat overlay's preload exposes on `window.gpChat`. */
export interface ChatBridge {
  ask(text: string): Promise<void>
  hide(): void
  appInfo(): Promise<AppInfo>
  onEvent(cb: (e: ChatEvent) => void): void
  skinCss(): Promise<string>
}

/** What the radio card window's preload exposes on `window.gpRadio`. */
export interface RadioBridge {
  onEvent(cb: (e: RadioCardEvent) => void): void
  /** The card has faded out: the window can hide. */
  done(): void
  skinCss(): Promise<string>
}
