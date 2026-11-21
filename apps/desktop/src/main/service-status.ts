import { execFile } from 'node:child_process'

/**
 * Slow-moving readings for the status view, fetched in the background and cached so the
 * status call itself never waits: GP's output device and ElevenLabs credits left.
 */

export interface ElevenLabsCredits {
  charactersLeft: number | null
  characterLimit: number | null
  resetsAt: string | null
}

export async function fetchElevenLabsCredits(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ElevenLabsCredits> {
  const res = await fetchImpl('https://api.elevenlabs.io/v1/user/subscription', {
    headers: { 'xi-api-key': apiKey },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}`)
  const j = (await res.json()) as {
    character_count?: number
    character_limit?: number
    next_character_count_reset_unix?: number
  }
  const limit = j.character_limit ?? null
  return {
    characterLimit: limit,
    charactersLeft: limit !== null && j.character_count != null ? limit - j.character_count : null,
    resetsAt: j.next_character_count_reset_unix
      ? new Date(j.next_character_count_reset_unix * 1000).toISOString()
      : null,
  }
}

/** macOS: the default output device's name, from system_profiler. */
export function defaultOutputDevice(): Promise<string | null> {
  if (process.platform !== 'darwin') return Promise.resolve(null)
  return new Promise((resolve) =>
    execFile(
      'system_profiler',
      ['SPAudioDataType', '-json'],
      { timeout: 10_000, maxBuffer: 4 << 20 },
      (err, out) => {
        if (err) return resolve(null)
        resolve(outputDeviceFrom(out))
      },
    ),
  )
}

export function outputDeviceFrom(json: string): string | null {
  try {
    const j = JSON.parse(json) as {
      SPAudioDataType?: {
        _items?: { _name?: string; coreaudio_default_audio_output_device?: string }[]
      }[]
    }
    for (const group of j.SPAudioDataType ?? [])
      for (const d of group._items ?? [])
        if (d.coreaudio_default_audio_output_device === 'spaudio_yes') return d._name ?? null
  } catch {}
  return null
}

/** Re-runs `get` every `everyMs` in the background; `value` is the latest result. */
export class Cached<T> {
  value: T
  error: string | null = null
  private timer: NodeJS.Timeout | null = null
  constructor(
    initial: T,
    private readonly get: () => Promise<T>,
    private readonly everyMs: number,
  ) {
    this.value = initial
  }
  start(): this {
    const tick = () =>
      this.get().then(
        (v) => {
          this.value = v
          this.error = null
        },
        (e) => {
          this.error = e instanceof Error ? e.message : String(e)
        },
      )
    void tick()
    this.timer = setInterval(tick, this.everyMs)
    this.timer.unref?.()
    return this
  }
  refresh(): Promise<void> {
    return this.get().then(
      (v) => {
        this.value = v
        this.error = null
      },
      (e) => {
        this.error = e instanceof Error ? e.message : String(e)
      },
    )
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }
}
