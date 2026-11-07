/**
 * Splits streamed text into sentences so speech can start after the first one instead of
 * waiting for the whole reply. Decimals ("1.2") don't split because there's no space after.
 */
export class SentenceSplitter {
  private buf = ''
  /** Shortest chunk worth a TTS request; shorter sentences get merged with the next. */
  constructor(private readonly minChars = 12) {}

  push(delta: string): string[] {
    this.buf += delta
    const out: string[] = []
    const re = /[.!?]+["')\]]?\s+/g
    let start = 0
    let m: RegExpExecArray | null = re.exec(this.buf)
    while (m) {
      const end = m.index + m[0].length
      const piece = this.buf.slice(start, end).trim()
      if (piece.length >= this.minChars) {
        out.push(piece)
        start = end
      }
      m = re.exec(this.buf)
    }
    this.buf = this.buf.slice(start)
    return out
  }

  flush(): string | null {
    const rest = this.buf.trim()
    this.buf = ''
    return rest || null
  }
}
