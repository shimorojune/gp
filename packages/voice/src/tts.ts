export interface TtsAudio {
  sampleRate: number
  /** Raw s16le mono PCM chunks as they stream in. */
  chunks: AsyncIterable<Buffer>
}

export interface Tts {
  readonly name: string
  synth(text: string, signal: AbortSignal, opts?: SynthOptions): Promise<TtsAudio>
}

export interface SynthOptions {
  /** Eleven v3 with audio tags ([sighs]); ~6s a line and 2x the credits, so opt-in only. */
  expressive?: boolean
  /** Neighbouring sentences, so intonation carries across sentence-by-sentence requests. */
  previousText?: string
}

/** Audio tags like [sighs] are only understood by Eleven v3; strip them for other voices. */
export function stripAudioTags(text: string): string {
  return text
    .replace(/\[[a-z][a-z\s-]{0,24}\]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** SSML-style pauses (<break time="0.4s" />) that Flash understands; not for display or Mac voice. */
export function stripBreaks(text: string): string {
  return text
    .replace(/<break\b[^>]*\/?>/gi, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Everything the TTS markup adds, so the text reads cleanly on screen or in the Mac voice. */
export function plainSpeech(text: string): string {
  return stripBreaks(stripAudioTags(text))
}

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name])
  return Number.isFinite(v) && process.env[name] !== '' && process.env[name] != null ? v : fallback
}

/** Rohit's pick ("version B", 2026-11-07): a bit less stable and more style than default. */
function flashVoiceSettings() {
  return {
    stability: num('GP_TTS_STABILITY', 0.4),
    similarity_boost: num('GP_TTS_SIMILARITY', 0.8),
    style: num('GP_TTS_STYLE', 0.3),
    speed: num('GP_TTS_SPEED', 1.0),
  }
}

/** Rohit's pick (2026-11-07). Override with GP_VOICE_ID. */
export const DEFAULT_VOICE_ID = '4VBYDqjeok174FJpT0Jc'

/**
 * ElevenLabs streaming TTS. Flash v2.5 is their low-latency model (~75ms model time); raw
 * PCM avoids decoding and goes straight into Web Audio for the radio effect.
 */
export class ElevenLabsTts implements Tts {
  readonly name = 'elevenlabs'
  private readonly sampleRate = 22_050
  constructor(
    private readonly apiKey: string,
    private readonly voiceId = process.env.GP_VOICE_ID ?? DEFAULT_VOICE_ID,
    private readonly model = process.env.GP_TTS_MODEL ?? 'eleven_flash_v2_5',
    private readonly expressiveModel = process.env.GP_TTS_EXPRESSIVE_MODEL ?? 'eleven_v3',
  ) {}

  async synth(raw: string, signal: AbortSignal, opts: SynthOptions = {}): Promise<TtsAudio> {
    const model = opts.expressive ? this.expressiveModel : this.model
    // v3 takes audio tags but not <break>; Flash takes <break> but reads tags out loud.
    const text = opts.expressive ? stripBreaks(raw) : stripAudioTags(raw)
    if (!plainSpeech(text)) throw new Error('nothing to say')
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream?output_format=pcm_${this.sampleRate}`
    const request = () =>
      fetch(url, {
        method: 'POST',
        signal,
        headers: {
          'xi-api-key': this.apiKey,
          'content-type': 'application/json',
          accept: 'audio/pcm',
        },
        body: JSON.stringify({
          text,
          model_id: model,
          // v3 only takes stability 0 / 0.5 / 1 (creative / natural / robust).
          voice_settings: opts.expressive
            ? { stability: 0.5, similarity_boost: 0.75 }
            : flashVoiceSettings(),
          ...(opts.previousText && !opts.expressive ? { previous_text: opts.previousText } : {}),
        }),
      })
    let res = await request()
    // ElevenLabs throws the odd 500; one quick retry, then the caller falls back to the Mac voice.
    if (res.status >= 500 && !signal.aborted) res = await request()
    if (!res.ok || !res.body)
      throw new Error(`elevenlabs ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const body = res.body as unknown as AsyncIterable<Uint8Array>
    return {
      sampleRate: this.sampleRate,
      chunks: (async function* () {
        // PCM samples are 2 bytes; keep chunk boundaries on whole samples.
        let carry: Buffer = Buffer.alloc(0)
        for await (const part of body) {
          const b: Buffer = Buffer.concat([carry, Buffer.from(part as Uint8Array)])
          const even = b.length - (b.length % 2)
          carry = b.subarray(even)
          if (even) yield b.subarray(0, even)
        }
      })(),
    }
  }
}
