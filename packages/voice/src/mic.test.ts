import { describe, expect, it } from 'vitest'
import { peakDb } from './mic.ts'

describe('peakDb', () => {
  it('measures the loudest sample in dBFS', () => {
    const pcm = Buffer.alloc(8)
    pcm.writeInt16LE(-16384, 2)
    expect(peakDb(pcm)).toBeCloseTo(-6.02, 1)
    expect(peakDb(Buffer.alloc(8))).toBe(Number.NEGATIVE_INFINITY)
  })
})
