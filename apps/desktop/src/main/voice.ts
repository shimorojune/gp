import type { EngineerSession, Reply } from '@gp/engineer'
import type { RaceState } from '@gp/telemetry'
import {
  CornerGate,
  DeepgramStt,
  DualSensePtt,
  ElevenLabsTts,
  F1_TERMS,
  Mic,
  SAMPLE_RATE,
  SentenceSplitter,
  type Stt,
  type SttStream,
  type Tts,
  WhisperStt,
  displayName,
  firstNamesFor,
  fixDriverNames,
  fixRadioPhrases,
  plainSpeech,
} from '@gp/voice'
import type { AudioMessage, ChatEvent } from '../ipc.ts'

export interface VoiceDeps {
  engineer: EngineerSession
  state: RaceState
  toAudio: (m: AudioMessage) => void
  toChat: (e: ChatEvent) => void
  log: (line: string) => void
}

/** Shorter than this is a bump of the button, not speech. */
const MIN_UTTERANCE_MS = 350
/** How long a sentence waits for a straight. Radio calls older than this are dropped. */
const STRAIGHT_WAIT_MS = 10_000

interface SpeakOptions {
  /** Emergencies talk through corners. */
  urgent?: boolean
  /** Drop it rather than say it late if no straight comes in time (automatic calls). */
  dropIfLate?: boolean
}

/**
 * Push-to-talk radio: DualSense button (L3 by default) -> mic -> STT -> engineer -> TTS -> speakers.
 * Everything that talks back (answers and automatic radio calls) goes through speak(), and
 * pressing the button cuts off whatever GP is saying.
 */
export class RadioVoice {
  readonly ptt = new DualSensePtt()
  readonly mic = new Mic()
  private readonly stt: Stt
  private readonly fallbackStt: WhisperStt
  private readonly tts: Tts | null
  private stream: SttStream | null = null
  private pressedAt = 0
  private utt = 0
  private speakAbort = new AbortController()
  private speakChain: Promise<void> = Promise.resolve()
  /** Reply ids whose text is streamed into speech sentence by sentence. */
  private splitters = new Map<number, SentenceSplitter>()
  /** Replies up to this id were cut off by the driver; ignore their remaining text. */
  private mutedThrough = 0
  private lastAskId = 0
  private readonly gate = new CornerGate()
  /** True on a straight, or whenever he isn't driving. */
  private clearToTalk = true
  private gateTimer: ReturnType<typeof setInterval> | null = null
  /** Utterance number of an answer to the driver that is still queued or playing. */
  private answering: number | null = null

  constructor(private readonly d: VoiceDeps) {
    this.fallbackStt = new WhisperStt()
    const dg = process.env.DEEPGRAM_API_KEY
    this.stt = dg ? new DeepgramStt(dg) : this.fallbackStt
    const el = process.env.ELEVENLABS_API_KEY
    this.tts = el ? new ElevenLabsTts(el) : null
  }

  start(): void {
    this.d.log(
      `[voice] stt=${this.stt.name}${this.stt === this.fallbackStt && !this.fallbackStt.available ? ' (model missing!)' : ''} tts=${this.tts?.name ?? 'mac voice'}`,
    )
    this.mic.on('error', (e) => this.status(`mic error: ${e.message}`))
    this.mic.start()
    this.ptt.on('connected', ({ transport }) => {
      this.status(`controller connected over ${transport}`)
      if (transport === 'bluetooth')
        this.status('the controller mic only works over USB; plug it in or set GP_MIC')
    })
    this.ptt.on('disconnected', () => this.status('controller disconnected'))
    this.ptt.on('error', (e) => this.d.log(`[ptt] ${e.message}`))
    this.ptt.on('down', () => this.pressed())
    this.ptt.on('up', () => void this.released())
    this.ptt.start()
    this.gateTimer = setInterval(() => {
      const live = this.d.state.snapshot().status === 'live'
      const straight = this.gate.update(this.d.state.playerInputs())
      this.clearToTalk = !live || process.env.GP_TALK_IN_CORNERS === '1' || straight
    }, 50)

    // Stream typed and spoken answers into speech as they're written.
    this.d.engineer.on('delta', ({ id, kind, text }) => {
      if (kind !== 'ask' || id <= this.mutedThrough) return
      this.lastAskId = Math.max(this.lastAskId, id)
      let sp = this.splitters.get(id)
      if (!sp) {
        sp = new SentenceSplitter()
        this.splitters.set(id, sp)
        this.newUtterance()
        this.answering = this.utt
      }
      for (const sentence of sp.push(text)) this.speak(sentence)
    })
    this.d.engineer.on('reply', (r: Reply) => {
      if (r.kind !== 'ask' || r.id <= this.mutedThrough) return
      const sp = this.splitters.get(r.id)
      this.splitters.delete(r.id)
      const rest = sp?.flush()
      if (rest) this.speak(rest)
      this.endUtterance()
    })
  }

  /** Speak a complete radio call (automatic checks). */
  radioCall(text: string, urgent = false): void {
    // Don't talk over the driver while he's holding the button.
    if (this.stream) return
    // His own question comes first: a routine call never cuts off the answer.
    if (this.answering !== null && !urgent) {
      this.d.log('[voice] radio call skipped, still answering the driver')
      return
    }
    // Otherwise newest news wins: cut whatever older call was still going.
    this.stopSpeaking()
    this.newUtterance()
    this.speak(text, { urgent, dropIfLate: !urgent })
    this.endUtterance()
  }

  /** The race order changed: anything still being said is about the old situation. */
  positionChanged(): void {
    if (this.stream || this.answering !== null) return
    this.stopSpeaking()
  }

  /** Keyboard fallback when the controller isn't connected: press to talk, press again to send. */
  toggleTalk(): void {
    if (this.stream) void this.released()
    else this.pressed()
  }

  private status(s: string): void {
    this.d.log(`[voice] ${s}`)
    this.d.toChat({ type: 'voice', status: s })
  }

  private hints(): string[] {
    const s = this.d.state.snapshot()
    const names = s.cars.map((c) => displayName(c.name))
    return [
      ...names,
      ...firstNamesFor(s.cars.map((c) => c.name)),
      ...(s.session ? [s.session.track] : []),
      ...F1_TERMS,
    ]
  }

  private pressed(): void {
    this.stopSpeaking()
    if (this.d.engineer.busy) void this.d.engineer.interrupt().catch(() => {})
    this.pressedAt = performance.now()
    this.d.toAudio({ type: 'beep', kind: 'open' })
    this.stream = this.stt.open(this.hints())
    const stream = this.stream
    this.mic.begin((pcm) => stream.write(pcm))
  }

  private async released(): Promise<void> {
    const stream = this.stream
    if (!stream) return
    this.stream = null
    const pcm = this.mic.end()
    this.d.toAudio({ type: 'beep', kind: 'close' })
    const heldMs = (pcm.length / 2 / SAMPLE_RATE) * 1000
    if (heldMs < MIN_UTTERANCE_MS) {
      stream.cancel()
      return
    }
    const t0 = performance.now()
    let text = ''
    let used = this.stt.name
    try {
      text = await stream.finish()
    } catch (e) {
      // Network trouble: fall back to local whisper on the same audio.
      this.d.log(`[stt] ${this.stt.name} failed (${(e as Error).message}), using whisper`)
      if (this.stt !== this.fallbackStt && this.fallbackStt.available) {
        used = this.fallbackStt.name
        const w = this.fallbackStt.open(this.hints())
        w.write(pcm)
        text = await w.finish().catch(() => '')
      }
    }
    const names = this.d.state.snapshot().cars.map((c) => c.name)
    text = fixRadioPhrases(fixDriverNames(text, names)).trim()
    const sttMs = Math.round(performance.now() - t0)
    this.d.log(
      `[stt] ${used} ${sttMs}ms after release (held ${Math.round(heldMs)}ms, pressed ${Math.round(t0 - this.pressedAt)}ms): "${text}"`,
    )
    if (!text) {
      this.status("didn't catch that")
      return
    }
    this.d.toChat({ type: 'heard', text, stt: used, sttMs })
    const live = this.d.state.snapshot().status === 'live'
    // On track, speed beats depth: Haiku answers in ~1.5-2s vs ~4.5s for Sonnet (Mac test).
    const model = live ? (process.env.GP_LIVE_MODEL ?? 'haiku') : undefined
    try {
      const r = await this.d.engineer.ask(`[voice] ${text}`, model ? { model } : {})
      this.d.toChat({
        type: 'reply',
        id: r.id,
        text: r.text,
        model: r.model,
        firstTextMs: r.firstTextMs,
        totalMs: r.totalMs,
        tools: r.toolCalls.map((t) => t.replace('mcp__race__', '')),
      })
      this.d.log(
        `[latency] release->text ${sttMs + (r.firstTextMs ?? 0)}ms (stt ${sttMs} + ${r.model} first words ${r.firstTextMs}ms)`,
      )
    } catch (e) {
      this.d.toChat({ type: 'error', message: (e as Error).message })
    }
  }

  private newUtterance(): void {
    this.utt++
    this.prevSentence = undefined
  }

  private endUtterance(): void {
    const utt = this.utt
    this.speakChain = this.speakChain.then(() => {
      this.d.toAudio({ type: 'end', utt })
      if (this.answering === utt) this.answering = null
    })
  }

  /** Last sentence sent to TTS in this utterance, for intonation continuity. */
  private prevSentence: string | undefined

  /** Resolves true once he's on a straight, false if the wait ran out or speech was cut. */
  private async waitForStraight(signal: AbortSignal): Promise<boolean> {
    const until = performance.now() + STRAIGHT_WAIT_MS
    while (!this.clearToTalk) {
      if (signal.aborted || performance.now() > until) return false
      await new Promise((r) => setTimeout(r, 50))
    }
    return !signal.aborted
  }

  private speak(text: string, opts: SpeakOptions = {}): void {
    const utt = this.utt
    const signal = this.speakAbort.signal
    // Hold each sentence until a straight (mid-reply too: he pauses through the corner).
    const gate = async (): Promise<boolean> => {
      if (opts.urgent) return !signal.aborted
      const ok = await this.waitForStraight(signal)
      if (!ok && !signal.aborted && !opts.dropIfLate) return true
      return ok
    }
    const clean = text.replace(/[*_#`]/g, '')
    const plain = plainSpeech(clean)
    if (!plain) return
    if (!this.tts) {
      this.speakChain = this.speakChain.then(async () => {
        if (!(await gate())) return
        if (!signal.aborted) this.d.toAudio({ type: 'say', utt, text: plain, ...macVoice() })
      })
      return
    }
    // Start the request now so it's ready when the previous sentence finishes.
    // Eleven v3 (audio tags) is opt-in and off track only: ~6s a line is too slow for radio.
    const expressive =
      this.d.state.snapshot().status !== 'live' && process.env.GP_TTS_EXPRESSIVE === '1'
    const previousText = this.prevSentence
    this.prevSentence = clean
    // Each sentence gets its own abort, tied to the cut-off signal, so a stalled ElevenLabs
    // stream can be dropped without wedging everything queued behind it.
    const own = new AbortController()
    const cut = () => own.abort()
    signal.addEventListener('abort', cut, { once: true })
    const t0 = performance.now()
    const short = plain.length > 40 ? `${plain.slice(0, 40)}...` : plain
    const synth = () =>
      this.tts!.synth(clean, own.signal, { expressive, previousText }).catch((e: Error) => {
        if (!own.signal.aborted) this.d.log(`[tts] error: ${e.message}`)
        return null
      })
    const audio = synth()
    this.speakChain = this.speakChain.then(async () => {
      const held = performance.now()
      if (!(await gate())) {
        own.abort()
        if (!signal.aborted) this.d.log(`[gate] dropped, no straight in time: "${short}"`)
        return
      }
      const waited = Math.round(performance.now() - held)
      if (waited > 100) this.d.log(`[gate] held ${waited}ms for a straight`)
      // Worst case for one sentence: ~0.1s per character of speech plus slack.
      const limitMs = 8000 + plain.length * 100
      const timer = setTimeout(() => {
        this.d.log(`[tts] timeout after ${limitMs}ms, skipping: "${short}"`)
        own.abort()
      }, limitMs)
      try {
        // One retry if ElevenLabs hands back an empty stream, then the Mac voice.
        for (let attempt = 0; attempt < 2; attempt++) {
          const a = await (attempt === 0 ? audio : synth())
          if (!a) break
          let bytes = 0
          for await (const chunk of a.chunks) {
            if (own.signal.aborted) return
            if (!bytes)
              this.d.log(`[tts] first audio ${Math.round(performance.now() - t0)}ms: "${short}"`)
            bytes += chunk.length
            this.d.toAudio({
              type: 'pcm',
              utt,
              sampleRate: a.sampleRate,
              pcm: new Uint8Array(chunk),
            })
          }
          if (own.signal.aborted) return
          if (bytes) {
            // Sentences are synthesised separately; a short breath between them sounds human.
            this.d.toAudio({ type: 'gap', utt, ms: 220 })
            return
          }
          this.d.log(
            `[tts] empty audio (status ${a.meta?.status}, request ${a.meta?.requestId ?? '?'}, attempt ${attempt + 1}): "${short}"`,
          )
        }
        if (!own.signal.aborted) this.d.toAudio({ type: 'say', utt, text: plain, ...macVoice() })
      } catch (e) {
        if (!own.signal.aborted) this.d.log(`[tts] ${(e as Error).message}`)
      } finally {
        clearTimeout(timer)
        signal.removeEventListener('abort', cut)
      }
    })
  }

  private stopSpeaking(): void {
    this.d.log('[voice] cut off')
    this.speakAbort.abort()
    this.speakAbort = new AbortController()
    this.speakChain = Promise.resolve()
    this.answering = null
    this.splitters.clear()
    this.mutedThrough = this.lastAskId
    this.d.toAudio({ type: 'stop' })
  }

  stop(): void {
    if (this.gateTimer) clearInterval(this.gateTimer)
    this.ptt.stop()
    this.mic.stop()
  }
}

const macVoice = () => (process.env.GP_MAC_VOICE ? { voice: process.env.GP_MAC_VOICE } : {})
