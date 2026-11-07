import type { AudioMessage } from '../ipc.ts'

/**
 * Plays GP's voice through a team-radio chain: band-limited to ~300-3400 Hz, a touch of
 * saturation and compression, with a squelch click at each end. PCM arrives in chunks and
 * is scheduled back to back so sentences flow without gaps.
 */
export class RadioPlayer {
  private ctx: AudioContext | null = null
  private input: AudioNode | null = null
  private playAt = 0
  private sources = new Set<AudioBufferSourceNode>()
  private openUtt: number | null = null
  private radio = true

  private ensure(): AudioContext {
    if (this.ctx) return this.ctx
    const ctx = new AudioContext()
    ctx.onstatechange = () => console.log(`[audio] context ${ctx.state}`)
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 320
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 3400
    const shaper = ctx.createWaveShaper()
    const curve = new Float32Array(1024)
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1
      curve[i] = Math.tanh(2.2 * x) / Math.tanh(2.2)
    }
    shaper.curve = curve
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -20
    comp.ratio.value = 6
    const out = ctx.createGain()
    out.gain.value = 0.9
    hp.connect(lp).connect(shaper).connect(comp).connect(out).connect(ctx.destination)
    this.ctx = ctx
    this.input = hp
    return ctx
  }

  setRadioEffect(on: boolean): void {
    this.radio = on
  }

  handle(m: AudioMessage): void {
    // macOS can suspend or interrupt the context (output device changes, sleep); a suspended
    // context accepts buffers silently and never plays them.
    if (this.ctx && this.ctx.state !== 'running' && m.type !== 'stop') {
      console.warn(`[audio] context ${this.ctx.state}, resuming`)
      void this.ctx.resume().catch((e) => console.error(`[audio] resume failed: ${e}`))
    }
    if (m.type === 'end')
      console.log(
        `[audio] utterance ${m.utt} queued, ends in ${this.ctx ? (this.playAt - this.ctx.currentTime).toFixed(1) : '?'}s`,
      )
    switch (m.type) {
      case 'pcm':
        this.startUtterance(m.utt)
        this.enqueue(m.pcm, m.sampleRate)
        break
      case 'say':
        this.say(m.text, m.voice)
        break
      case 'end':
        if (this.openUtt === m.utt) {
          this.squelch(this.playAt)
          this.openUtt = null
        }
        break
      case 'gap':
        if (this.openUtt === m.utt) this.playAt += m.ms / 1000
        break
      case 'stop':
        this.stop()
        break
      case 'beep':
        this.beep(m.kind)
        break
    }
  }

  private startUtterance(utt: number): void {
    if (this.openUtt === utt) return
    this.openUtt = utt
    const ctx = this.ensure()
    this.playAt = Math.max(this.playAt, ctx.currentTime + 0.03)
    this.squelch(this.playAt)
    this.playAt += 0.06
  }

  private enqueue(bytes: Uint8Array, sampleRate: number): void {
    const ctx = this.ensure()
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const n = Math.floor(bytes.byteLength / 2)
    if (!n) return
    const buf = ctx.createBuffer(1, n, sampleRate)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < n; i++) ch[i] = view.getInt16(i * 2, true) / 32768
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.radio ? this.input! : ctx.destination)
    const at = Math.max(this.playAt, ctx.currentTime + 0.02)
    src.start(at)
    this.playAt = at + buf.duration
    this.sources.add(src)
    src.onended = () => this.sources.delete(src)
  }

  /** Short burst of filtered noise, like a radio keying up or dropping. */
  private squelch(at: number): void {
    const ctx = this.ensure()
    const len = Math.floor(ctx.sampleRate * 0.05)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * 0.25 * (1 - i / len)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.input!)
    src.start(Math.max(at, ctx.currentTime))
    this.sources.add(src)
    src.onended = () => this.sources.delete(src)
  }

  /** Two-tone beep so the driver knows the mic is open/closed. */
  private beep(kind: 'open' | 'close'): void {
    const ctx = this.ensure()
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.frequency.value = kind === 'open' ? 1200 : 800
    g.gain.setValueAtTime(0.15, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08)
    osc.connect(g).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.09)
  }

  private say(text: string, preferred?: string): void {
    const u = new SpeechSynthesisUtterance(text)
    const voices = speechSynthesis.getVoices()
    const gb = voices.filter((v) => /en[-_]GB/i.test(v.lang))
    // Prefer a named voice, then a downloaded Premium/Enhanced British voice, then Daniel.
    const voice =
      (preferred && voices.find((v) => v.name.toLowerCase().includes(preferred.toLowerCase()))) ||
      gb.find((v) => /premium/i.test(v.name)) ||
      gb.find((v) => /enhanced/i.test(v.name)) ||
      gb.find((v) => /daniel/i.test(v.name)) ||
      gb[0]
    if (voice) u.voice = voice
    u.rate = 1.05
    speechSynthesis.speak(u)
  }

  private stop(): void {
    for (const s of this.sources) {
      try {
        s.stop()
      } catch {}
    }
    this.sources.clear()
    speechSynthesis.cancel()
    this.openUtt = null
    if (this.ctx) this.playAt = this.ctx.currentTime
  }
}
