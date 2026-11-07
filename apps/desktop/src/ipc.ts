import type { RaceSnapshot } from '@gp/telemetry'

export const IPC = {
  snapshot: 'gp:snapshot',
  toggleRecording: 'gp:toggle-recording',
  recordingState: 'gp:recording-state',
  toggleOnTop: 'gp:toggle-on-top',
  chatAsk: 'gp:chat-ask',
  chatEvent: 'gp:chat-event',
  chatHide: 'gp:chat-hide',
} as const

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

/** What the preload script exposes on `window.gp`. */
export interface GpBridge {
  onSnapshot(cb: (msg: SnapshotMessage) => void): void
  toggleRecording(): Promise<RecordingState>
  toggleOnTop(): Promise<boolean>
}

/** What the chat overlay's preload exposes on `window.gpChat`. */
export interface ChatBridge {
  ask(text: string): Promise<void>
  hide(): void
  onEvent(cb: (e: ChatEvent) => void): void
}
