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
  careers: 'gp:careers',
  careerAssign: 'gp:career-assign',
  careerRename: 'gp:career-rename',
  sessions: 'gp:sessions',
  careerMerge: 'gp:career-merge',
  settingsGet: 'gp:settings-get',
  settingsSave: 'gp:settings-save',
  voiceTest: 'gp:voice-test',
  dataInfo: 'gp:data-info',
  setProgram: 'gp:set-program',
  sessionDetail: 'gp:session-detail',
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
  /** Infisical isn't connected yet. */
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
  /** 'infisical' when the last fetch worked. There is no other source. */
  source: 'infisical' | 'none'
  fetchedAt: string | null
  error: string | null
  /** Expected secret name -> Infisical returned it in the last fetch. Never the values. */
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
  /** Mic input level 0..1 (RMS, smoothed) while the mic runs; null when it's off. */
  micLevel: number | null
  /** Where GP's voice plays (the system default output device's name), null if unknown. */
  outputDevice: string | null
  /** Claude: last answer's time to first text, and whether the last call failed. */
  /** auth 'none': no setup token from Infisical, the engineer is off. */
  claude: { lastLatencyMs: number | null; lastError: string | null; auth: 'setup token' | 'none' }
  /** ElevenLabs characters left this billing period, null until fetched or when not used. */
  elevenLabs: {
    charactersLeft: number | null
    characterLimit: number | null
    resetsAt: string | null
  }
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
  /** Restarts the app. */
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
  /** Careers and the career seasons still waiting for "new career, or season N of X?". */
  careers(): Promise<CareersInfo>
  /** File a season under an existing career or a new one; returns the refreshed list. */
  assignSeason(
    seasonLink: number,
    to: { careerId: string } | { newCareer: string },
  ): Promise<CareersInfo | { error: string }>
  renameCareer(id: string, name: string): Promise<CareersInfo | { error: string }>
  /** The debrief library, newest first. */
  sessions(filter?: SessionFilter): Promise<SessionListItem[]>
  /** Everything the debrief pane shows for one session, by the game's session uid. */
  sessionDetail(uid: string): Promise<SessionDetail | null>
  /**
   * Ask GP anything over the whole history (same engineer and tools as the chat overlay).
   * The answer streams back as ChatEvents ('delta' then 'reply') through onChat.
   */
  ask(text: string): Promise<void>
  onChat(cb: (e: ChatEvent) => void): void
  /** Move every season of one career into another (they become its next seasons). */
  mergeCareers(fromId: string, intoId: string): Promise<CareersInfo | { error: string }>
  /** Radio and Data settings, persisted in ~/Documents/GP/settings.json. */
  settings(): Promise<AppSettings>
  /** Partial change; radio can be partial too. Returns the saved settings. */
  saveSettings(patch: SettingsPatch): Promise<AppSettings | { error: string }>
  /** GP says one short line through the normal voice path. Resolves when it's been handed to the player. */
  testVoice(): Promise<{ tts: string } | { error: string }>
  dataInfo(): Promise<DataInfo>
  /** Re-file a session detection got wrong. Career only works for game career sessions. */
  setProgram(uid: string, program: Program): Promise<SessionDetail | { error: string }>
}

export interface RadioPrefsInfo {
  /** quiet: essentials only; chatty: comments on most laps and gaps. */
  chattiness: 'quiet' | 'normal' | 'chatty'
  /** Talk through corners instead of holding for a straight (urgent calls always talk). */
  callsInCorners: boolean
  /** Regular, specific encouragement. Off: only for notable moments. */
  encouragement: boolean
  /** Call out lost places (two or more). */
  callLostPlaces: boolean
  /** On a straight, where the last lap lost time and the fix. */
  timeLossCalls: boolean
}

export interface AppSettings {
  radio: RadioPrefsInfo
  /** Raw recordings kept on this Mac once they're read into the history: 0, 2 or 5. */
  keepRecordings: 0 | 2 | 5
}

export interface SettingsPatch {
  radio?: Partial<RadioPrefsInfo>
  keepRecordings?: 0 | 2 | 5
}

export interface DataInfo {
  /** Sessions in the history (all programs, attempts included). */
  sessions: number
  /** When this Mac first synced with Postgres (the one-time import), null if never. */
  firstSyncAt: string | null
  recordingsKept: 0 | 2 | 5
  /** GP_KEEP_RECORDINGS is set, so the keep-recordings choice has no effect: show it disabled. */
  recordingsOverride: boolean
}

export type Program = 'career' | 'time_trial' | 'sim'
export type SessionStatus = 'finished' | 'restarted' | 'abandoned'

export interface SessionFilter {
  program?: Program
  careerId?: string
  /** Career season (game season link). */
  seasonLink?: number
  /** Time trial: the car as stored (SessionListItem.car). */
  car?: string
  trackId?: number
  /** Include restarted and abandoned attempts (shown greyed). Default true. */
  includeAttempts?: boolean
  /** Default 200. */
  limit?: number
  /** ISO; sessions started before this, for paging. */
  before?: string
}

export interface SessionListItem {
  uid: string
  startedAt: string
  durationS: number
  program: Program
  /** The game's mode name, e.g. "Grand Prix", "Time Trial", "Career". */
  mode: string
  /** Practice 1, Qualifying 1, Race, Time Trial... */
  sessionType: string
  trackId: number
  track: string
  team: string | null
  car: string | null
  formula: string | null
  career: { id: string; name: string; season: number | null } | null
  /** Career seasons not yet filed under a career. */
  seasonLink: number | null
  weekendLink: number | null
  status: SessionStatus
  /** The attempt that replaced this one (status 'restarted'). */
  replacedBy: string | null
  lapsDone: number
  validLaps: number
  bestLapMs: number | null
  finishPos: number | null
  gridPos: number | null
  numCars: number | null
  points: number | null
  flashbacks: number
  /** GP's debrief has been written. */
  hasDebrief: boolean
  /** Not in Postgres yet (or changed since the last push). */
  pendingSync: boolean
}

export interface SessionDetail extends SessionListItem {
  weather: string | null
  trackTempC: number | null
  airTempC: number | null
  totalLaps: number | null
  aiDifficulty: number | null
  bestSectorsMs: [number | null, number | null, number | null]
  idealLapMs: number | null
  medianLapMs: number | null
  consistencyMs: number | null
  fieldBestMs: number | null
  pitStops: number | null
  penaltiesS: number | null
  resultStatus: string | null
  teammate: {
    name: string
    bestMs: number | null
    pos: number | null
    points: number | null
  } | null
  laps: {
    lap: number
    lapMs: number
    sectorsMs: [number | null, number | null, number | null]
    valid: boolean
    tyre: string | null
    tyreAge: number | null
    fuelKg: number | null
    wearPct: number | null
    position: number | null
    /** A flashback was used on this lap. */
    flashback: boolean
    /** Setup changed from the session's start setup on this lap (index into setups). */
    setup: number | null
  }[]
  /** Runs on one tyre set: lap range, compound, pace and wear. */
  stints: {
    fromLap: number
    toLap: number
    tyre: string | null
    laps: number
    avgLapMs: number | null
    wearPerLapPct: number | null
  }[]
  incidents: {
    lap: number | null
    kind: string
    detail: string | null
    sessionTime: number | null
    /** A flashback took it back: show struck through, left out of stats. */
    undone: boolean
  }[]
  classification: {
    position: number
    name: string
    team: string | null
    isPlayer: boolean
    grid: number | null
    points: number | null
    bestLapMs: number | null
    status: string | null
  }[]
  /** GP's one-line record of the session (always there once debriefed). */
  debrief: string | null
  /** The debrief pane's three parts; null for sessions debriefed before they existed. */
  debriefParts: { well: string; cost: string; work: string } | null
  /** His best valid lap at this track in the same car before this session (any program). */
  pbMs: number | null
  /** Setups used (session start first), as name -> value maps. */
  setups: { key: string; values: Record<string, number> }[]
}

export interface CareersInfo {
  careers: {
    id: string
    name: string
    createdAt: string
    seasons: { seasonLink: number; number: number | null; team: string | null }[]
  }[]
  unassigned: {
    seasonLink: number
    team: string | null
    firstSeen: string
    sessions: number
    tracks: string[]
  }[]
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
