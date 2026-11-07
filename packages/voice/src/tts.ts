export interface TtsAudio {
  sampleRate: number
  /** Raw s16le mono PCM chunks as they stream in. */
  chunks: AsyncIterable<Buffer>
}

export interface Tts {
  readonly name: string
  synth(text: string, signal: AbortSignal): Promise<TtsAudio>
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
  ) {}

  async synth(text: string, signal: AbortSignal): Promise<TtsAudio> {
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
          model_id: this.model,
          voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0, speed: 1.05 },
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
