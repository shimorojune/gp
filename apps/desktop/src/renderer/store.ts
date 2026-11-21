import type {
  AppInfo,
  GpBridge,
  PreflightResult,
  SnapshotMessage,
  StatusInfo,
  UpdateState,
} from '../ipc.ts'

declare global {
  interface Window {
    gp: GpBridge
  }
}

/** Everything the window shows that comes from the main process, in one place. */
export interface AppState {
  app: AppInfo | null
  update: UpdateState | null
  snapshot: SnapshotMessage | null
  status: StatusInfo | null
  preflight: PreflightResult | null
}

type Key = keyof AppState
const state: AppState = { app: null, update: null, snapshot: null, status: null, preflight: null }
const subs = new Set<{ keys: Key[] | null; fn: (s: AppState) => void }>()

export const get = () => state

export function set(patch: Partial<AppState>): void {
  Object.assign(state, patch)
  const changed = Object.keys(patch) as Key[]
  for (const s of subs) if (!s.keys || s.keys.some((k) => changed.includes(k))) s.fn(state)
}

/** Calls `fn` now and whenever one of `keys` changes. Returns the unsubscribe. */
export function watch(keys: Key[] | null, fn: (s: AppState) => void): () => void {
  const s = { keys, fn }
  subs.add(s)
  fn(state)
  return () => subs.delete(s)
}

export const gp = () => window.gp

export async function refreshStatus(): Promise<StatusInfo | null> {
  const s = await window.gp.status().catch(() => null)
  if (s) set({ status: s })
  return s
}

export async function runPreflight(): Promise<PreflightResult> {
  const r = await window.gp.preflight()
  set({ preflight: r })
  return r
}

/** Polls the live status while anything is watching it (the status line always is). */
export function startStatusPolling(ms = 2000): void {
  void refreshStatus()
  setInterval(() => void refreshStatus(), ms)
}
