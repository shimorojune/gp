import { contextBridge, ipcRenderer } from 'electron'
import { type GpBridge, IPC, type SnapshotMessage } from '../ipc.ts'

const bridge: GpBridge = {
  onSnapshot(cb) {
    ipcRenderer.on(IPC.snapshot, (_e, msg: SnapshotMessage) => cb(msg))
  },
  toggleRecording: () => ipcRenderer.invoke(IPC.toggleRecording),
  toggleOnTop: () => ipcRenderer.invoke(IPC.toggleOnTop),
}

contextBridge.exposeInMainWorld('gp', bridge)
