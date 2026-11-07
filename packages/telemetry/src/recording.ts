import { once } from 'node:events'
/**
 * .gprec recording format (little-endian):
 *
 *   magic   8 bytes  "GPREC1\0\0"
 *   metaLen u32      length of the JSON metadata that follows
 *   meta    utf8     JSON: { createdAt, source, note? }
 *   records repeated:
 *     t     f64      ms since the recording started
 *     len   u16      datagram length
 *     data  len      raw UDP payload, exactly as the game sent it
 *
 * Raw datagrams (not parsed objects) are stored so recordings stay valid when the parser
 * changes, and so they can be replayed over real UDP into any consumer.
 */
import { type WriteStream, createReadStream, createWriteStream } from 'node:fs'

const MAGIC = Buffer.from('GPREC1\0\0', 'latin1')
const RECORD_HEADER = 10

export interface RecordingMeta {
  createdAt: string
  source: string
  note?: string
}

export interface RecordedPacket {
  /** ms since the recording started */
  t: number
  buf: Buffer
}

export class RecordingWriter {
  private readonly stream: WriteStream
  private readonly startedAt: number
  count = 0
  bytes = 0

  constructor(path: string, meta: Partial<RecordingMeta> = {}, now = Date.now()) {
    this.startedAt = now
    this.stream = createWriteStream(path)
    const json = Buffer.from(
      JSON.stringify({ createdAt: new Date(now).toISOString(), source: 'f1-23-udp', ...meta }),
    )
    const len = Buffer.alloc(4)
    len.writeUInt32LE(json.length)
    this.stream.write(Buffer.concat([MAGIC, len, json]))
  }

  write(buf: Buffer, at = Date.now()): void {
    const head = Buffer.alloc(RECORD_HEADER)
    head.writeDoubleLE(at - this.startedAt, 0)
    head.writeUInt16LE(buf.length, 8)
    this.stream.write(head)
    this.stream.write(buf)
    this.count++
    this.bytes += buf.length + RECORD_HEADER
  }

  async close(): Promise<void> {
    this.stream.end()
    await once(this.stream, 'finish')
  }
}

/** Stream a recording without loading it all into memory (a full race is hundreds of MB). */
export async function* readRecording(
  path: string,
): AsyncGenerator<RecordedPacket, void, undefined> {
  let pending: Buffer = Buffer.alloc(0)
  let headerDone = false
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) {
    pending = pending.length ? Buffer.concat([pending, chunk as Buffer]) : (chunk as Buffer)
    let offset = 0
    if (!headerDone) {
      if (pending.length < 12) continue
      if (!pending.subarray(0, 8).equals(MAGIC)) throw new Error(`${path} is not a .gprec file`)
      const metaLen = pending.readUInt32LE(8)
      if (pending.length < 12 + metaLen) continue
      offset = 12 + metaLen
      headerDone = true
    }
    while (pending.length - offset >= RECORD_HEADER) {
      const t = pending.readDoubleLE(offset)
      const len = pending.readUInt16LE(offset + 8)
      if (pending.length - offset - RECORD_HEADER < len) break
      const start = offset + RECORD_HEADER
      yield { t, buf: Buffer.from(pending.subarray(start, start + len)) }
      offset = start + len
    }
    pending = pending.subarray(offset)
  }
}

export async function readRecordingMeta(path: string): Promise<RecordingMeta> {
  for await (const chunk of createReadStream(path, { start: 0, end: 64 * 1024 })) {
    const buf = chunk as Buffer
    if (!buf.subarray(0, 8).equals(MAGIC)) throw new Error(`${path} is not a .gprec file`)
    const metaLen = buf.readUInt32LE(8)
    return JSON.parse(buf.subarray(12, 12 + metaLen).toString('utf8')) as RecordingMeta
  }
  throw new Error(`${path} is empty`)
}

export interface ReplayOptions {
  /** 1 = real time, 4 = four times faster, Infinity = as fast as possible. */
  speed?: number
  signal?: AbortSignal
}

/** Yield recorded packets paced to their original timing (scaled by `speed`). */
export async function* replayRecording(
  path: string,
  opts: ReplayOptions = {},
): AsyncGenerator<RecordedPacket, void, undefined> {
  const speed = opts.speed ?? 1
  const wallStart = performance.now()
  for await (const pkt of readRecording(path)) {
    if (opts.signal?.aborted) return
    if (Number.isFinite(speed)) {
      const due = wallStart + pkt.t / speed
      const wait = due - performance.now()
      if (wait > 1) await new Promise((r) => setTimeout(r, wait))
    }
    yield pkt
  }
}
