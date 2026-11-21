import { describe, expect, it } from 'vitest'
import { fetchElevenLabsCredits, outputDeviceFrom } from './service-status.ts'

describe('service status', () => {
  it('reads the default output device from system_profiler', () => {
    const json = JSON.stringify({
      SPAudioDataType: [
        {
          _items: [
            { _name: 'MacBook Pro Speakers' },
            { _name: 'realme Buds', coreaudio_default_audio_output_device: 'spaudio_yes' },
          ],
        },
      ],
    })
    expect(outputDeviceFrom(json)).toBe('realme Buds')
    expect(outputDeviceFrom('nonsense')).toBeNull()
  })

  it('works out ElevenLabs characters left', async () => {
    const fake = (async () =>
      new Response(
        JSON.stringify({
          character_count: 8600,
          character_limit: 10000,
          next_character_count_reset_unix: 1_800_000_000,
        }),
      )) as unknown as typeof fetch
    expect(await fetchElevenLabsCredits('k', fake)).toEqual({
      charactersLeft: 1400,
      characterLimit: 10000,
      resetsAt: new Date(1_800_000_000_000).toISOString(),
    })
  })
})
