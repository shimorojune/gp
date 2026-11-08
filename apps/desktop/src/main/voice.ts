import { join } from 'node:path'
import type { EngineerSession, Reply } from '@gp/engineer'
import { type RaceState, isDriving } from '@gp/telemetry'
import {
  CachedTts,
  CornerGate,
  DEFAULT_VOICE_ID,
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
  gpHome,
  peakDb,
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
/** Keep recording this long after the button is released. */
const POST_ROLL_MS = 350
// Speech on the DualSense mic peaks around -18 dB; a muted or stuck capture stays near -40 dB or below.
const QUIET_DB = -32
/** How long a sentence waits for a straight. Radio calls older than this are dropped. */
const STRAIGHT_WAIT_MS = 10_000
// He just asked and is waiting: hold for a straight only briefly. A 9 s hold looked like
// silence, he pressed again, and the cut-off threw the unheard answer away.
const ANSWER_WAIT_MS = 1_500
// Off track, long answers are read on screen; only the first few sentences are spoken.
// Long garage answers were the biggest ElevenLabs cost. 0 = speak everything.
const OFFTRACK_SPOKEN = Number(process.env.GP_OFFTRACK_SPOKEN_SENTENCES ?? 3)

interface SpeakOptions {
  /** Emergencies talk through corners. */
  urgent?: boolean
  /** Drop it rather than say it late if no straight comes in time (automatic calls). */
  dropIfLate?: boolean
  /** Longest hold for a straight before speaking anyway (default STRAIGHT_WAIT_MS). */
  maxWaitMs?: number
}

/**
 * Push-to-talk radio: DualSense button (L3 by default) -> mic -> STT -> engineer -> TTS -> speakers.
 * Everything that talks back (answers and automatic radio calls) goes through speak(), and
 * pressing the button cuts off whatever GP is saying.
 */
export class RadioVoice {
  readonly ptt = new DualSensePtt()
  readonly mic = new Mic()
  // One sentence playing, one being fetched: enough to stay ahead, and when he cuts in the
  // rest of a long answer was never paid for.
  private readonly ttsSlots = new Slots(2)
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
  private stopped = false
  /** Utterance number of an answer to the driver that is still queued or playing. */
  private answering: number | null = null

  constructor(private readonly d: VoiceDeps) {
    this.fallbackStt = new WhisperStt()
    const dg = process.env.DEEPGRAM_API_KEY
    this.stt = dg ? new DeepgramStt(dg) : this.fallbackStt
    const el = process.env.ELEVENLABS_API_KEY
    // Short repeated lines replay from disk instead of costing credits again.
    const variant = [
      process.env.GP_VOICE_ID ?? DEFAULT_VOICE_ID,
      process.env.GP_TTS_MODEL ?? 'eleven_flash_v2_5',
      process.env.GP_TTS_STABILITY,
      process.env.GP_TTS_SIMILARITY,
      process.env.GP_TTS_STYLE,
      process.env.GP_TTS_SPEED,
    ].join('|')
    this.tts = el
      ? new CachedTts(new ElevenLabsTts(el), join(gpHome(), 'tts-cache'), variant)
      : null
  }

  start(): void {
    this.d.log(
      `[voice] stt=${this.stt.name}${this.stt === this.fallbackStt && !this.fallbackStt.available ? ' (model missing!)' : ''} tts=${this.tts?.name ?? 'mac voice'}`,
    )
    // The controller (and its mic) can be off when the app starts or drop out mid-session:
    // keep trying, and say so once rather than every few seconds.
    let micErrorShown = false
    this.mic.on('error', (e) => {
      if (micErrorShown) return
      micErrorShown = true
      this.status(`mic error: ${e.message}`)
    })
    this.mic.on('exit', () => {
      if (this.stopped) return
      setTimeout(() => {
        if (!this.stopped && !this.mic.running) this.mic.start()
      }, 3000)
    })
    this.mic.start()
    this.ptt.on('connected', ({ transport }) => {
      this.status(`controller connected over ${transport}`)
      if (!this.mic.running) this.mic.start()
      micErrorShown = false
      if (transport === 'bluetooth')
        this.status('the controller mic only works over USB; plug it in or set GP_MIC')
    })
    this.ptt.on('disconnected', () => this.status('controller disconnected'))
    this.ptt.on('error', (e) => this.d.log(`[ptt] ${e.message}`))
    this.ptt.on('down', () => this.pressed())
    this.ptt.on('up', () => void this.released())
    this.ptt.start()
    this.gateTimer = setInterval(() => {
      const snap = this.d.state.snapshot()
      const live = isDriving(snap)
      // Pit lane: speed-limited, no corners worth protecting.
      const inPits = !!snap.cars.find((c) => c.isPlayer)?.pitStatus
      const straight = this.gate.update(this.d.state.playerInputs())
      this.clearToTalk = !live || inPits || process.env.GP_TALK_IN_CORNERS === '1' || straight
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
        this.d.log(`[voice] speaking answer #${id} as utterance ${this.utt}`)
      }
      for (const sentence of sp.push(text)) this.speakAnswer(id, sentence)
    })
    this.d.engineer.on('reply', (r: Reply) => {
      if (r.kind !== 'ask' || r.id <= this.mutedThrough) return
      const sp = this.splitters.get(r.id)
      this.splitters.delete(r.id)
      const rest = sp?.flush()
      if (rest) this.speakAnswer(r.id, rest)
      const n = this.spokenCount.get(r.id) ?? 0
      if (n > OFFTRACK_SPOKEN && OFFTRACK_SPOKEN > 0)
        this.d.log(
          `[voice] answer #${r.id}: spoke ${OFFTRACK_SPOKEN} of ${n} sentences (rest on screen)`,
        )
      this.spokenCount.delete(r.id)
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
    this.d.log(`[voice] speaking radio call as utterance ${this.utt}${urgent ? ' (urgent)' : ''}`)
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
    this.d.toAudio({ type: 'beep', kind: 'close' })
    // People let go of the button on their last word; keep listening a moment longer.
    await new Promise((r) => setTimeout(r, POST_ROLL_MS))
    const pcm = this.mic.end()
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
      const db = peakDb(pcm)
      if (db < QUIET_DB) {
        // Nothing but room noise: the mic is muted, or capture got stuck on silence after the
        // device changed under it. A fresh capture fixes the second case.
        this.d.log(`[voice] near-silent press (peak ${db.toFixed(0)} dB), restarting mic capture`)
        this.mic.restart()
        this.status("didn't hear you: mic muted? (light under PS button) Restarted the mic.")
      } else this.status("didn't catch that")
      return
    }
    this.d.toChat({ type: 'heard', text, stt: used, sttMs })
    const live = isDriving(this.d.state.snapshot())
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
  private async waitForStraight(signal: AbortSignal, maxMs = STRAIGHT_WAIT_MS): Promise<boolean> {
    const until = performance.now() + maxMs
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
      const ok = await this.waitForStraight(signal, opts.maxWaitMs)
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
    const expressive = !isDriving(this.d.state.snapshot()) && process.env.GP_TTS_EXPRESSIVE === '1'
    const previousText = this.prevSentence
    this.prevSentence = clean
    // Each sentence gets its own abort, tied to the cut-off signal, so a stalled ElevenLabs
    // stream can be dropped without wedging everything queued behind it.
    const own = new AbortController()
    const cut = () => own.abort()
    signal.addEventListener('abort', cut, { once: true })
    const t0 = performance.now()
    const short = plain.length > 40 ? `${plain.slice(0, 40)}...` : plain
    // ElevenLabs allows 6 requests at once on this plan; a long answer used to start one per
    // sentence and get 429s. Each sentence holds a slot until its audio is played or dropped.
    const slot = this.ttsSlots.acquire(own.signal)
    let released = false
    const release = () => {
      if (released) return
      released = true
      void slot.then((ok) => ok && this.ttsSlots.release())
    }
    own.signal.addEventListener('abort', release, { once: true })
    const synth = async () => {
      if (!(await slot)) return null
      for (let tries = 0; ; tries++) {
        try {
          return await this.tts!.synth(clean, own.signal, { expressive, previousText })
        } catch (e) {
          const msg = (e as Error).message
          // Too many at once: wait our turn rather than switch voices mid-answer.
          if (/429|concurrent/i.test(msg) && tries < 3 && !own.signal.aborted) {
            await new Promise((r) => setTimeout(r, 400 * (tries + 1)))
            continue
          }
          if (!own.signal.aborted) this.d.log(`[tts] error: ${msg}`)
          return null
        }
      }
    }
    const audio = synth()
    this.speakChain = this.speakChain.then(async () => {
      const held = performance.now()
      if (!(await gate())) {
        release()
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
        release()
      }
    })
  }

  private spokenCount = new Map<number, number>()

  private speakAnswer(id: number, sentence: string): void {
    const n = (this.spokenCount.get(id) ?? 0) + 1
    this.spokenCount.set(id, n)
    if (OFFTRACK_SPOKEN > 0 && n > OFFTRACK_SPOKEN && !isDriving(this.d.state.snapshot())) return
    this.speak(sentence, { maxWaitMs: ANSWER_WAIT_MS })
  }

  private stopSpeaking(): void {
    this.d.log(
      `[voice] cut off${this.answering !== null ? ` (answer utterance ${this.answering} not finished)` : ''}`,
    )
    this.speakAbort.abort()
    this.speakAbort = new AbortController()
    this.speakChain = Promise.resolve()
    this.answering = null
    this.splitters.clear()
    this.mutedThrough = this.lastAskId
    this.d.toAudio({ type: 'stop' })
  }

  stop(): void {
    this.stopped = true
    if (this.gateTimer) clearInterval(this.gateTimer)
    this.ptt.stop()
    this.mic.stop()
  }
}

const macVoice = () => (process.env.GP_MAC_VOICE ? { voice: process.env.GP_MAC_VOICE } : {})

/** A FIFO counting semaphore; waiting is abandoned when the signal aborts. */
class Slots {
  private free: number
  private waiting: { resolve: (ok: boolean) => void; signal: AbortSignal }[] = []
  constructor(n: number) {
    this.free = n
  }
  acquire(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false)
    if (this.free > 0) {
      this.free--
      return Promise.resolve(true)
    }
    return new Promise((resolve) => {
      const w = { resolve, signal }
      this.waiting.push(w)
      signal.addEventListener(
        'abort',
        () => {
          const i = this.waiting.indexOf(w)
          if (i >= 0) {
            this.waiting.splice(i, 1)
            resolve(false)
          }
        },
        { once: true },
      )
    })
  }
  release(): void {
    const next = this.waiting.shift()
    if (next) next.resolve(true)
    else this.free++
  }
}
