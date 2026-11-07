import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gpHome } from './env.ts'
import { SAMPLE_RATE, toWav } from './mic.ts'

/** One push-to-talk utterance. Stream audio in with write(), then finish() for the text. */
export interface SttStream {
  write(pcm: Buffer): void
  finish(): Promise<string>
  cancel(): void
}

export interface Stt {
  readonly name: string
  /** `hints` are words to bias towards: driver names, tracks, F1 terms. */
  open(hints: string[]): SttStream
}

export const F1_TERMS = [
  'box',
  'undercut',
  'overcut',
  'DRS',
  'ERS',
  'softs',
  'mediums',
  'hards',
  'inters',
  'wets',
  'deg',
  'safety car',
  'VSC',
  'pit window',
  'brake bias',
  'front wing',
  'tyre wear',
  'sector',
  'delta',
  'stint',
]

/**
 * Deepgram streaming (primary). Audio streams over a WebSocket while the button is held,
 * so the transcript is ready ~200-400ms after release instead of transcribing afterwards.
 */
export class DeepgramStt implements Stt {
  readonly name = 'deepgram'
  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.GP_DEEPGRAM_MODEL ?? 'nova-3',
  ) {}

  open(hints: string[]): SttStream {
    const params = new URLSearchParams({
      model: this.model,
      encoding: 'linear16',
      sample_rate: String(SAMPLE_RATE),
      channels: '1',
      smart_format: 'true',
      punctuate: 'true',
    })
    for (const h of [...new Set(hints)].slice(0, 50)) params.append('keyterm', h)
    // Browser-style WebSocket can't set headers; Deepgram accepts the key as a subprotocol.
    const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ['token', this.apiKey])
    ws.binaryType = 'arraybuffer'
    const pending: Buffer[] = []
    const finals: string[] = []
    let done: ((text: string) => void) | null = null
    let fail: ((e: Error) => void) | null = null
    let error: Error | null = null
    let closed = false

    ws.addEventListener('open', () => {
      for (const b of pending.splice(0)) ws.send(b)
    })
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string') return
      try {
        const msg = JSON.parse(ev.data) as {
          type?: string
          is_final?: boolean
          channel?: { alternatives?: { transcript?: string }[] }
        }
        if (msg.type === 'Results' && msg.is_final) {
          const t = msg.channel?.alternatives?.[0]?.transcript?.trim()
          if (t) finals.push(t)
        }
      } catch {}
    })
    ws.addEventListener('error', () => {
      error = new Error('deepgram websocket error')
    })
    ws.addEventListener('close', (ev) => {
      closed = true
      if (ev.code !== 1000 && !error) error = new Error(`deepgram closed ${ev.code} ${ev.reason}`)
      if (error && !finals.length) fail?.(error)
      else done?.(finals.join(' '))
    })

    return {
      write: (pcm) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(pcm)
        else if (ws.readyState === WebSocket.CONNECTING) pending.push(pcm)
      },
      finish: () =>
        new Promise<string>((resolve, reject) => {
          done = resolve
          fail = reject
          if (closed) {
            if (error && !finals.length) reject(error)
            else resolve(finals.join(' '))
            return
          }
          const close = () => ws.send(JSON.stringify({ type: 'CloseStream' }))
          if (ws.readyState === WebSocket.OPEN) close()
          else ws.addEventListener('open', close)
          // Never hang the radio on the network.
          setTimeout(() => {
            if (!closed) {
              ws.close()
              resolve(finals.join(' '))
            }
          }, 4000)
        }),
      cancel: () => ws.close(),
    }
  }
}

export const defaultWhisperModel = () => join(gpHome(), 'models', 'ggml-base.en.bin')

/**
 * whisper.cpp on the CPU (fallback, no key needed). Phase 0: base.en with -ng -t 4 has no
 * measurable effect on the game; ~0.9s idle, ~2s while driving. Never use the GPU on track.
 */
export class WhisperStt implements Stt {
  readonly name = 'whisper'
  constructor(
    private readonly model = process.env.GP_WHISPER_MODEL ?? defaultWhisperModel(),
    private readonly bin = process.env.GP_WHISPER_BIN ?? 'whisper-cli',
  ) {}

  get available(): boolean {
    return existsSync(this.model)
  }

  open(hints: string[]): SttStream {
    const chunks: Buffer[] = []
    let cancelled = false
    return {
      write: (pcm) => {
        chunks.push(pcm)
      },
      cancel: () => {
        cancelled = true
      },
      finish: async () => {
        if (cancelled) return ''
        const dir = await mkdtemp(join(tmpdir(), 'gp-stt-'))
        const wav = join(dir, 'ptt.wav')
        try {
          await writeFile(wav, toWav(Buffer.concat(chunks)))
          const prompt = `F1 race engineer radio. ${[...new Set(hints)].slice(0, 40).join(', ')}.`
          const out = await new Promise<string>((resolve, reject) =>
            execFile(
              this.bin,
              [
                '-m',
                this.model,
                '-f',
                wav,
                '-ng',
                '-t',
                '4',
                '-nt',
                '-np',
                '-l',
                'en',
                '--prompt',
                prompt,
              ],
              { timeout: 15_000 },
              (err, stdout) => (err ? reject(err) : resolve(stdout)),
            ),
          )
          return out
            .replace(/\[[^\]]*\]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        } finally {
          await rm(dir, { recursive: true, force: true })
        }
      },
    }
  }
}
