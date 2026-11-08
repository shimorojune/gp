import { contextBridge, ipcRenderer } from 'electron'
import {
  type AudioMessage,
  type ChatBridge,
  type ChatEvent,
  type GpBridge,
  IPC,
  type SnapshotMessage,
} from '../ipc.ts'

const bridge: GpBridge = {
  onSnapshot(cb) {
    ipcRenderer.on(IPC.snapshot, (_e, msg: SnapshotMessage) => cb(msg))
  },
  toggleRecording: () => ipcRenderer.invoke(IPC.toggleRecording),
  toggleOnTop: () => ipcRenderer.invoke(IPC.toggleOnTop),
  onAudio(cb) {
    ipcRenderer.on(IPC.audio, (_e, m: AudioMessage) => cb(m))
  },
  notes: () => ipcRenderer.invoke(IPC.notesGet),
  saveProfile: (text) => ipcRenderer.invoke(IPC.profileSave, text),
  addNote: (note) => ipcRenderer.invoke(IPC.noteAdd, note),
  removeNote: (id) => ipcRenderer.invoke(IPC.noteRemove, id),
}

contextBridge.exposeInMainWorld('gp', bridge)

const chat: ChatBridge = {
  ask: (text) => ipcRenderer.invoke(IPC.chatAsk, text),
  hide: () => ipcRenderer.send(IPC.chatHide),
  onEvent(cb) {
    ipcRenderer.on(IPC.chatEvent, (_e, ev: ChatEvent) => cb(ev))
  },
}

contextBridge.exposeInMainWorld('gpChat', chat)
