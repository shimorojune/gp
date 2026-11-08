import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SynthOptions, Tts, TtsAudio } from './tts.ts'

/**
 * Short lines ("Loud and clear.", "Box, box.", "Good lap.") come up again and again; every
 * repeat used to cost ElevenLabs credits. Lines up to `maxChars` are kept as PCM on disk and
 * replayed for free. Longer lines are mostly unique, so they aren't worth the disk.
 */
export class CachedTts implements Tts {
  readonly name: string
  hits = 0
  constructor(
    private readonly inner: Tts,
    private readonly dir: string,
    /** Anything that changes the sound of a line: voice, model, settings. */
    private readonly variant: string,
    private readonly maxChars = 48,
  ) {
    this.name = inner.name
    mkdirSync(dir, { recursive: true })
  }

  async synth(text: string, signal: AbortSignal, opts: SynthOptions = {}): Promise<TtsAudio> {
    const t = text.trim()
    if (opts.expressive || t.length > this.maxChars) return this.inner.synth(text, signal, opts)
    const key = createHash('sha1').update(`${this.variant}|${t.toLowerCase()}`).digest('hex')
    const file = join(this.dir, `${key}.pcm`)
    if (existsSync(file)) {
      const pcm = readFileSync(file)
      const rate = pcm.readUInt32LE(0)
      this.hits++
      return {
        sampleRate: rate,
        chunks: (async function* () {
          yield pcm.subarray(4)
        })(),
      }
    }
    // Same intonation every time beats a slightly better fit to the previous sentence.
    const { previousText: _ignored, ...rest } = opts
    const audio = await this.inner.synth(text, signal, rest)
    const parts: Buffer[] = []
    const inner = audio.chunks
    return {
      ...audio,
      chunks: (async function* () {
        for await (const c of inner) {
          parts.push(c)
          yield c
        }
        // Only a line that played to the end gets kept.
        if (parts.length && !signal.aborted) {
          const head = Buffer.alloc(4)
          head.writeUInt32LE(audio.sampleRate, 0)
          try {
            writeFileSync(`${file}.tmp`, Buffer.concat([head, ...parts]))
            renameSync(`${file}.tmp`, file)
          } catch {}
        }
      })(),
    }
  }
}
