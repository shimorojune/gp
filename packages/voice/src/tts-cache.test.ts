import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CachedTts } from './tts-cache.ts'
import type { Tts } from './tts.ts'

const drain = async (it: AsyncIterable<Buffer>) => {
  const out: Buffer[] = []
  for await (const c of it) out.push(c)
  return Buffer.concat(out)
}

describe('CachedTts', () => {
  it('pays for a short line once, then replays it', async () => {
    let calls = 0
    const inner: Tts = {
      name: 'fake',
      synth: async () => {
        calls++
        return {
          sampleRate: 22050,
          chunks: (async function* () {
            yield Buffer.from([1, 2, 3, 4])
          })(),
        }
      },
    }
    const tts = new CachedTts(inner, mkdtempSync(join(tmpdir(), 'tts-')), 'v1')
    const sig = new AbortController().signal
    expect(await drain((await tts.synth('Loud and clear.', sig)).chunks)).toEqual(
      Buffer.from([1, 2, 3, 4]),
    )
    const again = await tts.synth('loud and clear.', sig)
    expect(again.sampleRate).toBe(22050)
    expect(await drain(again.chunks)).toEqual(Buffer.from([1, 2, 3, 4]))
    expect(calls).toBe(1)
    await drain(
      (await tts.synth('A much longer sentence that is not worth caching at all.', sig)).chunks,
    )
    await drain(
      (await tts.synth('A much longer sentence that is not worth caching at all.', sig)).chunks,
    )
    expect(calls).toBe(3)
  })
})
