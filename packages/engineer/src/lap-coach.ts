import {
  type CompletedLapTrace,
  type CornerDelta,
  type LapTrace,
  compareTraces,
  straightAheadS,
} from '@gp/history'
import { type RaceState, isDriving, sessionKind } from '@gp/telemetry'
import { DEFAULT_RADIO_PREFS, type RadioPrefs } from './persona.ts'

/**
 * Where he's losing time, said only on a straight.
 *
 * After each lap: compare it corner by corner with a reference lap (his best this session, or
 * his stored best at this track in this car), pick the one corner that costs the most, and
 * work out why (braking early, apex speed, late on the throttle). The line waits until he's on
 * a straight that the reference lap says is long enough to say it, and is dropped if none
 * comes before it goes stale. All deterministic: no model in the loop, short repeatable lines
 * (cheap to synthesise, often cached).
 */

export interface ReferenceLap {
  lapMs: number
  trace: LapTrace
  /** For the log and the engineer's context: "session best", "best at this track". */
  label: string
}

export interface LapCoachDeps {
  state: RaceState
  /** The lap he just completed (with its trace), from the live collector. */
  lastLap: () => (CompletedLapTrace & { trackId: number | null }) | null
  /** His best clean lap this session (live collector). */
  sessionBest: () => { trackId: number | null; lapMs: number; trace: LapTrace } | null
  /** His stored best at this track in the car he's driving now (history DB). */
  storedBest: (trackId: number) => { lapMs: number; trace: LapTrace } | null
  /** Names a spot on the lap the way the other calls do ("corner 4"). */
  locate?: (lapDistanceM: number) => string | null
  /** Nothing else on the radio right now: not talking, not answering, button not held. */
  canTalk: () => boolean
  /** Put it on the radio. */
  say: (text: string) => void
  /** Tell the engineer what was said, so a follow-up question makes sense. */
  addContext?: (text: string) => void
  prefs?: () => RadioPrefs
  log?: (line: string) => void
  now?: () => number
}

export interface CoachCall {
  text: string
  kind: 'loss' | 'better'
  corner: string
  lossMs: number
}

/** Below this a corner isn't worth a call: noise, fuel, a gust of dirty air. */
const MIN_LOSS_MS = 150
/** A loss this big on one lap counts even if the lap before was fine there. */
const ONE_LAP_LOSS_MS = 300
/** With a repeat: the lap before lost at least this much at the same corner. */
const REPEAT_LOSS_MS = 80
/** Bigger than this at one corner is a mistake (off, lock-up, spin), already obvious to him. */
const MISTAKE_MS = 1200
/** A lap this far off the reference isn't a lap to coach from (traffic, damage, a moment). */
const MAX_OFF_PCT = 4
/** He was this close behind the car ahead in a corner: the time went in dirty air. */
const CLOSE_BEHIND_MS = 1000
/** Not the same corner again within this many laps. */
const CORNER_COOLDOWN_LAPS = 3
/** Laps between time-loss calls, by chattiness. */
const LAPS_BETWEEN: Record<RadioPrefs['chattiness'], number> = { quiet: 3, normal: 1, chatty: 1 }
/** A call that hasn't gone out this long after the lap is about an old lap: drop it. */
const STALE_MS = 75_000
/** Words per second in GP's voice, and the slack for TTS to start (ms). */
const WORDS_PER_S = 2.6
const TTS_START_S = 1.2

export class LapCoach {
  private pending: (CoachCall & { at: number; lap: number }) | null = null
  /** Corner name -> loss (ms) on the last few compared laps, newest last. */
  private losses = new Map<string, number[]>()
  /** Corner name -> lap number it was last called on. */
  private calledAt = new Map<string, number>()
  /** The last loss call that went out, to say so when he fixes it. */
  private lastCall: { corner: string; lossMs: number; lap: number } | null = null
  private lastCallLap = Number.NEGATIVE_INFINITY
  /** Bins of the current lap where he was right behind another car. */
  private closeBins = new Set<number>()
  /** Things on the current lap that make it no use for coaching. */
  private spoiled = false
  private straightSince: number | null = null
  private ref: ReferenceLap | null = null
  private readonly now: () => number

  constructor(private readonly d: LapCoachDeps) {
    this.now = d.now ?? Date.now
  }

  private get prefs(): RadioPrefs {
    return this.d.prefs?.() ?? DEFAULT_RADIO_PREFS
  }

  /** A new session or a restart: nothing from before applies. */
  reset(): void {
    this.pending = null
    this.losses.clear()
    this.calledAt.clear()
    this.lastCall = null
    this.lastCallLap = Number.NEGATIVE_INFINITY
    this.closeBins.clear()
    this.spoiled = false
    this.straightSince = null
    this.ref = null
  }

  /** What's waiting for a straight (for tests and the log). */
  get queued(): CoachCall | null {
    return this.pending
  }

  /**
   * The reference to coach against: his best clean lap this session once he has one, before
   * that his stored best here in this car.
   */
  private reference(trackId: number, lap: CompletedLapTrace): ReferenceLap | null {
    const live = this.d.sessionBest()
    if (live && live.trackId === trackId && live.trace.lap !== lap.lap)
      return { lapMs: live.lapMs, trace: live.trace, label: 'session best' }
    const stored = this.d.storedBest(trackId)
    if (stored) return { ...stored, label: 'best at this track in this car' }
    return null
  }

  /** Call once the lap is complete (the collector must already have it). */
  lapDone(lapNumber: number): CoachCall | null {
    const spoiled = this.spoiled
    const close = this.closeBins
    this.spoiled = false
    this.closeBins = new Set()
    // Whatever was waiting is about the lap before this one.
    this.pending = null
    if (!this.prefs.timeLossCalls) return null
    const s = this.d.state.snapshot()
    const kind = sessionKind(s.session?.sessionType)
    // Races and practice-style running. Qualifying is push laps: no lectures on the out lap.
    if (kind === 'qualifying' || kind === 'unknown') return null
    // Lap 1 of a race is a standing start and a scramble; the last lap can't be acted on.
    if (kind === 'race' && (lapNumber <= 1 || lapNumber >= (s.session?.totalLaps ?? 0))) return null
    const lap = this.d.lastLap()
    const trackId = s.session?.trackId
    if (!lap || lap.lap !== lapNumber || trackId === undefined || lap.trackId !== trackId)
      return null
    if (spoiled || !lap.valid || lap.flashback) return this.skip(lapNumber, 'not a clean lap')
    const ref = this.reference(trackId, lap)
    if (!ref) return null
    this.ref = ref
    // Faster than the reference: that's a PB, the lap call says so. Nothing to fix.
    if (lap.lapMs <= ref.lapMs) return this.skip(lapNumber, `quicker than the ${ref.label}`)
    if (lap.lapMs > ref.lapMs * (1 + MAX_OFF_PCT / 100))
      return this.skip(lapNumber, `${((lap.lapMs / ref.lapMs - 1) * 100).toFixed(1)}% off`)
    const deltas = compareTraces(ref.trace, lap.trace)
    if (!deltas.length) return null
    if (deltas.some((c) => c.timeMs > MISTAKE_MS)) return this.skip(lapNumber, 'a big moment')

    const named = deltas.map((c) => ({ c, name: this.d.locate?.(c.atM) ?? `corner ${c.corner}` }))
    const prev = new Map(this.losses)
    for (const { c, name } of named) {
      const xs = [...(this.losses.get(name) ?? []), c.timeMs].slice(-3)
      this.losses.set(name, xs)
    }

    const call = this.pick(lapNumber, named, prev, close, ref.trace.binM)
    if (!call) return null
    this.pending = { ...call, at: this.now(), lap: lapNumber }
    this.d.log?.(`[coach] lap ${lapNumber} vs ${ref.label}: queued "${call.text}"`)
    return call
  }

  private skip(lap: number, why: string): null {
    this.d.log?.(`[coach] lap ${lap}: no call (${why})`)
    return null
  }

  private pick(
    lapNumber: number,
    named: { c: CornerDelta; name: string }[],
    prev: Map<string, number[]>,
    close: Set<number>,
    binM: number,
  ): CoachCall | null {
    // He fixed the corner we told him about: say so. That's worth more than the next problem.
    const last = this.lastCall
    if (last && lapNumber - last.lap <= 2) {
      const now = named.find((n) => n.name === last.corner)
      if (now && now.c.timeMs <= Math.min(50, last.lossMs - 100)) {
        this.lastCall = null
        if (this.prefs.encouragement)
          return {
            text: `Better through ${now.name}. Keep that.`,
            kind: 'better',
            corner: now.name,
            lossMs: now.c.timeMs,
          }
      }
    }
    const gap = LAPS_BETWEEN[this.prefs.chattiness]
    if (lapNumber - this.lastCallLap < gap) return null
    const inTraffic = (c: CornerDelta) => {
      const apex = Math.round(c.atM / binM)
      for (let i = apex - 8; i <= apex + 3; i++) if (close.has(i)) return true
      return false
    }
    const candidates = named
      .filter(({ c, name }) => {
        if (c.timeMs < MIN_LOSS_MS || inTraffic(c)) return false
        const called = this.calledAt.get(name)
        if (called !== undefined && lapNumber - called < CORNER_COOLDOWN_LAPS) return false
        const before = prev.get(name)?.at(-1)
        return c.timeMs >= ONE_LAP_LOSS_MS || (before ?? 0) >= REPEAT_LOSS_MS
      })
      .sort((a, b) => b.c.timeMs - a.c.timeMs)
    const top = candidates[0]
    if (!top) return null
    return { text: lossLine(top.name, top.c), kind: 'loss', corner: top.name, lossMs: top.c.timeMs }
  }

  /** Run often (every 100 ms or so): watches the lap and puts a queued call out on a straight. */
  tick(): boolean {
    const s = this.d.state.snapshot()
    const me = s.cars.find((c) => c.isPlayer)
    const driving = isDriving(s) && !!me
    if (driving && me) {
      // Pit lane, safety car: this lap tells us nothing about his driving.
      if (me.pitStatus || (s.session?.safetyCar && s.session.safetyCar !== 'None'))
        this.spoiled = true
      if (
        sessionKind(s.session?.sessionType) === 'race' &&
        me.position > 1 &&
        me.deltaToCarInFrontMs > 0 &&
        me.deltaToCarInFrontMs < CLOSE_BEHIND_MS &&
        me.lapDistanceM >= 0
      )
        this.closeBins.add(Math.floor(me.lapDistanceM / (this.ref?.trace.binM ?? 20)))
    }
    const p = this.pending
    if (!p) return false
    if (this.now() - p.at > STALE_MS) {
      this.d.log?.(`[coach] dropped, no straight in time: "${p.text}"`)
      this.pending = null
      return false
    }
    if (!driving || !me || me.pitStatus || !this.ref) return false
    if (s.session?.safetyCar && s.session.safetyCar !== 'None') return false
    // On a straight now: flat out, wheel straight, for a moment.
    const i = this.d.state.playerInputs()
    const straightNow =
      !!i && i.throttle >= 0.9 && i.brake < 0.05 && Math.abs(i.steer) < 0.12 && i.speedKph > 100
    if (!straightNow) {
      this.straightSince = null
      return false
    }
    this.straightSince ??= this.now()
    if (this.now() - this.straightSince < 300) return false
    // ...and long enough to finish the line before the next braking zone.
    const need = words(p.text) / WORDS_PER_S + TTS_START_S
    const left = straightAheadS(this.ref.trace, me.lapDistanceM)
    if (left < need || !this.d.canTalk()) return false
    this.pending = null
    const lap = p.lap
    if (p.kind === 'loss') {
      this.lastCall = { corner: p.corner, lossMs: p.lossMs, lap }
      this.lastCallLap = lap
      this.calledAt.set(p.corner, lap)
    }
    this.d.log?.(`[coach] said on a ${left.toFixed(1)}s straight: "${p.text}"`)
    this.d.say(p.text)
    this.d.addContext?.(
      `[time-loss call] On the straight you told him: "${p.text}" (lap ${lap} vs his ${this.ref.label}${p.kind === 'loss' ? `, ${p.lossMs} ms at ${p.corner}` : ''}).`,
    )
    return true
  }
}

const words = (t: string) => t.split(/\s+/).filter(Boolean).length

const NUM = ['', 'a', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']

/** 230 -> "two tenths", 480 -> "half a second". Spoken words, so lines repeat (TTS cache). */
export function tenths(ms: number): string {
  const t = Math.max(1, Math.round(ms / 100))
  if (t === 5) return 'half a second'
  if (t >= 10) return 'a second'
  return t === 1 ? 'a tenth' : `${NUM[t]} tenths`
}

/** Metres, to the nearest 5. */
const metres = (m: number) => Math.max(5, Math.round(Math.abs(m) / 5) * 5)

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** One fact and one instruction: where, how much, and the fix the trace points at. */
export function lossLine(corner: string, c: CornerDelta): string {
  const where = `${cap(corner)}, losing ${tenths(c.timeMs)}.`
  const slower = c.minKph <= c.refMinKph - 4
  if (c.brakeLaterM !== null && c.brakeLaterM <= -10)
    return `${where} Brake ${metres(c.brakeLaterM)} metres later.`
  if (c.brakeLaterM !== null && c.brakeLaterM >= 10 && slower)
    return `${where} Braking too deep, it costs the exit.`
  if (slower) return `${where} Carry more speed to the apex.`
  if (c.throttleLaterM !== null && c.throttleLaterM >= 15)
    return `${where} Earlier on the throttle out of there.`
  return `${where} Look at the exit.`
}

/**
 * Wires the coach to the race: a lap check on every completed lap of his, a reset on every new
 * session, and a 10 Hz watch for the straight. Returns a stop function.
 */
export function attachLapCoach(deps: LapCoachDeps): { coach: LapCoach; stop: () => void } {
  const coach = new LapCoach(deps)
  const offLap = deps.state.on('lapCompleted', (l) => {
    if (l.isPlayer) coach.lapDone(l.lapNumber)
  })
  const offSession = deps.state.on('sessionStarted', () => coach.reset())
  const timer = setInterval(() => coach.tick(), 100)
  return {
    coach,
    stop: () => {
      clearInterval(timer)
      offLap()
      offSession()
    },
  }
}
