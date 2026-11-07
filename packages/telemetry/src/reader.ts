/** Little-endian cursor over a packet buffer. Every F1 23 struct is packed, no padding. */
export class Reader {
  offset: number

  constructor(
    readonly buf: Buffer,
    offset = 0,
  ) {
    this.offset = offset
  }

  u8(): number {
    const v = this.buf.readUInt8(this.offset)
    this.offset += 1
    return v
  }
  i8(): number {
    const v = this.buf.readInt8(this.offset)
    this.offset += 1
    return v
  }
  u16(): number {
    const v = this.buf.readUInt16LE(this.offset)
    this.offset += 2
    return v
  }
  i16(): number {
    const v = this.buf.readInt16LE(this.offset)
    this.offset += 2
    return v
  }
  u32(): number {
    const v = this.buf.readUInt32LE(this.offset)
    this.offset += 4
    return v
  }
  u64(): bigint {
    const v = this.buf.readBigUInt64LE(this.offset)
    this.offset += 8
    return v
  }
  f32(): number {
    const v = this.buf.readFloatLE(this.offset)
    this.offset += 4
    return v
  }
  f64(): number {
    const v = this.buf.readDoubleLE(this.offset)
    this.offset += 8
    return v
  }
  /** Fixed-length, NUL-padded UTF-8 string. */
  str(length: number): string {
    const slice = this.buf.subarray(this.offset, this.offset + length)
    this.offset += length
    const nul = slice.indexOf(0)
    return slice.subarray(0, nul === -1 ? length : nul).toString('utf8')
  }
  skip(n: number): void {
    this.offset += n
  }

  array<T>(count: number, read: (r: Reader) => T): T[] {
    const out: T[] = new Array(count)
    for (let i = 0; i < count; i++) out[i] = read(this)
    return out
  }
  /** Four wheels, in the game's order: RL, RR, FL, FR. */
  wheels<T>(read: (r: Reader) => T): Wheels<T> {
    return [read(this), read(this), read(this), read(this)]
  }
}

/** Per-wheel tuple in the game's order: rear-left, rear-right, front-left, front-right. */
export type Wheels<T> = [rl: T, rr: T, fl: T, fr: T]

export const u8 = (r: Reader) => r.u8()
export const f32 = (r: Reader) => r.f32()
export const u16 = (r: Reader) => r.u16()
