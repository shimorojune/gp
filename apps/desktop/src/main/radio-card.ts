import { join } from 'node:path'
import type { RaceSnapshot } from '@gp/telemetry'
// The overlay radio card window: transparent, click-through, never takes focus, floats over the
// fullscreen game in the top right. Shown when something goes over the radio; the card fades
// itself out and the window hides again, so nothing sits over the game between calls.
import { BrowserWindow, ipcMain, screen } from 'electron'
import { IPC, type RadioCardEvent } from '../ipc.ts'

const WIDTH = 380
const HEIGHT = 560

/** Your driver's name for the card header: the surname, like 'NORRIS RADIO' on TV. */
export function cardDriver(snapshot: RaceSnapshot): {
  driver: string
  number: number | null
  teamId: number | null
} {
  const me = snapshot.cars.find((c) => c.isPlayer)
  const name = (me?.name ?? '').trim()
  // The game sends 'Player' (or nothing) when it has no name for you.
  const surname = !name || /^player$/i.test(name) ? 'Team' : (name.split(/\s+/).at(-1) ?? name)
  return {
    driver: surname,
    number: me?.raceNumber || null,
    teamId: me ? me.teamId : null,
  }
}

export class RadioCardWindow {
  private win: BrowserWindow | null = null
  private ready: Promise<void> | null = null

  constructor(
    private readonly d: { snapshot: () => RaceSnapshot; dir: string; log: (l: string) => void },
  ) {
    ipcMain.on(IPC.radioDone, (e) => {
      if (this.win && e.sender === this.win.webContents) this.win.hide()
    })
    ipcMain.on(IPC.radioLevel, (_e, level: number) => {
      if (this.win?.isVisible()) this.send({ type: 'level', level })
    })
  }

  get window(): BrowserWindow | null {
    return this.win
  }

  create(): BrowserWindow {
    if (this.win) return this.win
    const w = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      title: 'GP radio card',
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      focusable: false,
      alwaysOnTop: true,
      show: false,
      skipTaskbar: true,
      // Same non-activating panel as the chat overlay, so showing it never pulls macOS out
      // of the game's fullscreen Space.
      ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
      webPreferences: {
        preload: join(this.d.dir, 'preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    })
    w.setAlwaysOnTop(true, 'screen-saver')
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    // Clicks go straight through to the game.
    w.setIgnoreMouseEvents(true)
    this.place(w)
    this.ready = w.loadFile(join(this.d.dir, 'renderer', 'radio.html')).catch((e) => {
      this.d.log(`[radio-card] load failed: ${e instanceof Error ? e.message : e}`)
    })
    w.on('closed', () => {
      this.win = null
      this.ready = null
    })
    this.win = w
    return w
  }

  /** Top right of the main display, a little down from the top edge. */
  private place(w: BrowserWindow): void {
    const b = screen.getPrimaryDisplay().bounds
    w.setBounds({
      x: Math.round(b.x + b.width - WIDTH - 16),
      y: Math.round(b.y + b.height * 0.16),
      width: WIDTH,
      height: HEIGHT,
    })
  }

  /** A line over the radio: shows the card (without focus) with your driver's name and colour. */
  async line(who: 'gp' | 'driver', text: string): Promise<void> {
    const w = this.create()
    await this.ready
    this.send({ type: 'line', who, text, ...cardDriver(this.d.snapshot()) })
    if (!w.isDestroyed() && !w.isVisible()) {
      this.place(w)
      w.showInactive()
    }
  }

  private send(e: RadioCardEvent): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(IPC.radioCard, e)
  }

  destroy(): void {
    this.win?.destroy()
  }
}
