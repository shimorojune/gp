import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PacketId } from '../src/constants.ts'
import {
  RecordingWriter,
  readRecording,
  readRecordingMeta,
  replayRecording,
} from '../src/recording.ts'
import { buildPacket } from './build.ts'

describe('recording', () => {
  it('round-trips raw datagrams with timestamps', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'gprec-')), 'a.gprec')
    const w = new RecordingWriter(path, { note: 'test' }, 1000)
    const a = buildPacket(PacketId.Motion, { frame: 1 })
    const b = buildPacket(PacketId.Event, { frame: 2 })
    w.write(a, 1000)
    w.write(b, 1050)
    await w.close()

    const out = []
    for await (const pkt of readRecording(path)) out.push(pkt)
    expect(out).toHaveLength(2)
    expect(out[0]!.t).toBe(0)
    expect(out[1]!.t).toBe(50)
    expect(out[0]!.buf.equals(a)).toBe(true)
    expect(out[1]!.buf.equals(b)).toBe(true)
    expect((await readRecordingMeta(path)).note).toBe('test')
  })

  it('handles recordings larger than one read chunk', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'gprec-')), 'big.gprec')
    const w = new RecordingWriter(path, {}, 0)
    const n = 2500 // ~3.4 MB, several 1 MB chunks
    for (let i = 0; i < n; i++) w.write(buildPacket(PacketId.Motion, { frame: i }), i)
    await w.close()
    let count = 0
    let lastFrame = -1
    for await (const pkt of replayRecording(path, { speed: Number.POSITIVE_INFINITY })) {
      const frame = pkt.buf.readUInt32LE(19)
      expect(frame).toBe(lastFrame + 1)
      lastFrame = frame
      count++
    }
    expect(count).toBe(n)
  })
})
