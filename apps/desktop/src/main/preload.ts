import { contextBridge, ipcRenderer } from 'electron'
import {
  type AudioMessage,
  type ChatBridge,
  type ChatEvent,
  type GpBridge,
  IPC,
  type RadioBridge,
  type RadioCardEvent,
  type SnapshotMessage,
  type UpdateState,
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
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  onUpdate(cb) {
    ipcRenderer.on(IPC.updateState, (_e, s: UpdateState) => cb(s))
  },
  checkUpdate: () => ipcRenderer.invoke(IPC.updateCheck),
  installUpdate: () => ipcRenderer.invoke(IPC.updateInstall),
  preflight: () => ipcRenderer.invoke(IPC.preflight),
  saveKeys: (keys) => ipcRenderer.invoke(IPC.saveKeys, keys),
  secretsStatus: () => ipcRenderer.invoke(IPC.secretsStatus),
  saveSecrets: (cfg) => ipcRenderer.invoke(IPC.secretsSave, cfg),
  testSecrets: (cfg) => ipcRenderer.invoke(IPC.secretsTest, cfg),
  clearSecrets: () => ipcRenderer.invoke(IPC.secretsClear),
  status: () => ipcRenderer.invoke(IPC.status),
  careers: () => ipcRenderer.invoke(IPC.careers),
  assignSeason: (seasonLink, to) => ipcRenderer.invoke(IPC.careerAssign, seasonLink, to),
  renameCareer: (id, name) => ipcRenderer.invoke(IPC.careerRename, id, name),
  sessions: (filter) => ipcRenderer.invoke(IPC.sessions, filter),
  sessionDetail: (uid) => ipcRenderer.invoke(IPC.sessionDetail, uid),
  ask: (text) => ipcRenderer.invoke(IPC.chatAsk, text),
  onChat: (cb) => {
    ipcRenderer.on(IPC.chatEvent, (_e, ev: ChatEvent) => cb(ev))
  },
  relaunch: () => ipcRenderer.send(IPC.relaunch),
  radioLevel: (level) => ipcRenderer.send(IPC.radioLevel, level),
  skinCss: () => ipcRenderer.invoke(IPC.skinCss),
}

contextBridge.exposeInMainWorld('gp', bridge)

const chat: ChatBridge = {
  ask: (text) => ipcRenderer.invoke(IPC.chatAsk, text),
  hide: () => ipcRenderer.send(IPC.chatHide),
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  onEvent(cb) {
    ipcRenderer.on(IPC.chatEvent, (_e, ev: ChatEvent) => cb(ev))
  },
  skinCss: () => ipcRenderer.invoke(IPC.skinCss),
}

contextBridge.exposeInMainWorld('gpChat', chat)

const radio: RadioBridge = {
  onEvent(cb) {
    ipcRenderer.on(IPC.radioCard, (_e, ev: RadioCardEvent) => cb(ev))
  },
  done: () => ipcRenderer.send(IPC.radioDone),
  skinCss: () => ipcRenderer.invoke(IPC.skinCss),
}

contextBridge.exposeInMainWorld('gpRadio', radio)
