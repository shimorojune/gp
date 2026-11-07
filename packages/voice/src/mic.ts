import { type ChildProcess, spawn } from 'node:child_process'
import { TypedEmitter } from '@gp/shared'

export const SAMPLE_RATE = 16_000

export interface MicOptions {
  /** avfoundation audio device name or index. Default: the DualSense ("DualSense Wireless Controller"). */
  device?: string
  ffmpeg?: string
  /** Audio kept from before the button press, so the first word isn't clipped. */
  preRollMs?: number
}

type MicEvents = { error: Error; exit: { code: number | null } }

/**
 * Always-warm microphone: ffmpeg captures 16 kHz mono s16le continuously (starting ffmpeg
 * on each press costs ~0.3-0.5s and eats the first word). Audio is only kept between
 * begin() and end(), plus a short pre-roll.
 */
export class Mic extends TypedEmitter<MicEvents> {
  private proc: ChildProcess | null = null
  private ring: Buffer[] = []
  private ringBytes = 0
  private take: Buffer[] | null = null
  private onChunk: ((b: Buffer) => void) | null = null
  private readonly preRollBytes: number

  constructor(private readonly opts: MicOptions = {}) {
    super()
    this.preRollBytes = Math.round(((opts.preRollMs ?? 250) / 1000) * SAMPLE_RATE) * 2
  }

  start(): void {
    if (this.proc) return
    const device = this.opts.device ?? process.env.GP_MIC ?? 'DualSense Wireless Controller'
    const proc = spawn(
      this.opts.ffmpeg ?? process.env.GP_FFMPEG ?? 'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'avfoundation',
        '-i',
        `:${device}`,
        '-ac',
        '1',
        '-ar',
        String(SAMPLE_RATE),
        '-f',
        's16le',
        '-',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    this.proc = proc
    let stderr = ''
    proc.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    proc.stdout?.on('data', (chunk: Buffer) => this.ingest(chunk))
    proc.on('error', (e) => this.emit('error', e))
    proc.on('exit', (code) => {
      this.proc = null
      if (code) this.emit('error', new Error(`ffmpeg exited ${code}: ${stderr.trim().slice(-300)}`))
      this.emit('exit', { code })
    })
  }

  private ingest(chunk: Buffer): void {
    if (this.take) {
      this.take.push(chunk)
      this.onChunk?.(chunk)
      return
    }
    this.ring.push(chunk)
    this.ringBytes += chunk.length
    while (this.ring.length > 1 && this.ringBytes - this.ring[0]!.length >= this.preRollBytes) {
      this.ringBytes -= this.ring.shift()!.length
    }
  }

  get running(): boolean {
    return this.proc !== null
  }

  /** Start keeping audio. `onChunk` gets the pre-roll first, then live chunks (for streaming STT). */
  begin(onChunk?: (pcm: Buffer) => void): void {
    this.take = [...this.ring]
    this.ring = []
    this.ringBytes = 0
    this.onChunk = onChunk ?? null
    for (const c of this.take) this.onChunk?.(c)
  }

  /** Stop keeping audio and return everything since begin() as 16 kHz mono s16le. */
  end(): Buffer {
    const pcm = Buffer.concat(this.take ?? [])
    this.take = null
    this.onChunk = null
    return pcm
  }

  stop(): void {
    this.proc?.kill('SIGTERM')
    this.proc = null
  }
}

/** Wrap s16le mono PCM in a WAV header. */
export function toWav(pcm: Buffer, sampleRate = SAMPLE_RATE): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + pcm.length, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22)
  h.writeUInt32LE(sampleRate, 24)
  h.writeUInt32LE(sampleRate * 2, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}
