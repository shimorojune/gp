import { TypedEmitter } from '@gp/shared'
import HID from 'node-hid'

const SONY = 0x054c
const DUALSENSE = [0x0ce6, 0x0df2] // DualSense, DualSense Edge
const MUTE_BIT = 0x04

type PttEvents = {
  down: undefined
  up: undefined
  connected: { transport: 'usb' | 'bluetooth' }
  disconnected: undefined
  error: Error
}

/**
 * Push-to-talk on the DualSense mic-mute button, read straight from HID in non-exclusive
 * mode so the game keeps the controller. Apple's GameController API can't see this button
 * (Phase 0). USB report 0x01 has buttons at bytes 8-10, Bluetooth report 0x31 one byte later.
 */
export class DualSensePtt extends TypedEmitter<PttEvents> {
  private dev: HID.HID | null = null
  private pressed = false
  private retry: ReturnType<typeof setInterval> | null = null

  /** Byte index of the mute button for a report, or -1 if this report isn't an input report. */
  static muteByte(data: Buffer | number[]): number {
    if (data[0] === 0x01 && data.length >= 11) return 10
    if (data[0] === 0x31 && data.length >= 12) return 11
    return -1
  }

  static isMuteDown(data: Buffer | number[]): boolean | null {
    const i = DualSensePtt.muteByte(data)
    return i < 0 ? null : ((data[i] ?? 0) & MUTE_BIT) !== 0
  }

  start(): void {
    this.tryOpen()
    // Reconnect if the controller is plugged in later or drops out.
    this.retry = setInterval(() => {
      if (!this.dev) this.tryOpen()
    }, 2000)
  }

  private tryOpen(): void {
    const info = HID.devices().find(
      (d) =>
        d.vendorId === SONY &&
        DUALSENSE.includes(d.productId) &&
        d.path &&
        (d.usagePage ?? 1) === 1,
    )
    if (!info?.path) return
    try {
      const dev = new HID.HID(info.path, { nonExclusive: true })
      this.dev = dev
      let announced = false
      dev.on('data', (data: Buffer) => {
        if (!announced) {
          announced = true
          this.emit('connected', { transport: data[0] === 0x31 ? 'bluetooth' : 'usb' })
        }
        const down = DualSensePtt.isMuteDown(data)
        if (down === null || down === this.pressed) return
        this.pressed = down
        this.emit(down ? 'down' : 'up', undefined)
      })
      dev.on('error', (err: Error) => {
        this.emit('error', err)
        this.drop()
      })
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
    }
  }

  private drop(announce = true): void {
    try {
      this.dev?.close()
    } catch {}
    this.dev = null
    if (this.pressed) {
      this.pressed = false
      this.emit('up', undefined)
    }
    if (announce) this.emit('disconnected', undefined)
  }

  stop(): void {
    if (this.retry) clearInterval(this.retry)
    this.retry = null
    this.drop(false)
  }
}
