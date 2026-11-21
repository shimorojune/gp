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
}

/** What the chat overlay's preload exposes on `window.gpChat`. */
export interface ChatBridge {
  ask(text: string): Promise<void>
  hide(): void
  appInfo(): Promise<AppInfo>
  onEvent(cb: (e: ChatEvent) => void): void
}
