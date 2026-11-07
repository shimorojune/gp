import { formatLapTime } from '@gp/shared'
import { INFRINGEMENT_TYPES, PENALTY_TYPES, type RaceState } from '@gp/telemetry'
import { SILENT } from './persona.ts'
import type { EngineerSession, Reply } from './session.ts'

export interface CallInfo {
  /** Safety car, a penalty to serve: say it now, even mid-corner, and cut anything else. */
  urgent: boolean
}

export interface RadioOptions {
  /** Called with each radio call the engineer decides to make (not silent ones). */
  onCall?: (reply: Reply, info: CallInfo) => void
  /** Minimum gap between automatic checks, in ms of wall time. Events in between are batched. */
  minGapMs?: number
  /** A position change has to hold this long before it counts (swaps back and forth, lap 1). */
  settleMs?: number
  /** How often to look at the player's position. */
  pollMs?: number
  /**
   * Called the moment the player's position changes (before the check comes back), so the
   * voice can cut off anything it was saying about the old order.
   */
  onPositionChange?: (from: number, to: number) => void
  now?: () => number
}

interface Queued {
  text: string
  kind: 'position' | 'urgent' | 'other'
}

/**
 * Feeds race events to the engineer as [event] turns (which run on the cheap check model).
 * Events are batched: at most one check in flight, at least `minGapMs` apart, and anything
 * that happens meanwhile goes into the next check as one message.
 * Phase 5 replaces this with deterministic callouts and an attention budget.
 */
export function attachRadio(state: RaceState, engineer: EngineerSession, opts: RadioOptions = {}) {
  const minGapMs = opts.minGapMs ?? 8000
  const settleMs = opts.settleMs ?? 2000
  const pollMs = opts.pollMs ?? 500
  const now = opts.now ?? Date.now
  let queued: Queued[] = []
  /** Bumped on every position change; a check that started before one is stale. */
  let positionVersion = 0
  let inFlight = false
  let lastSentAt = Number.NEGATIVE_INFINITY
  let timer: ReturnType<typeof setTimeout> | null = null
  let closed = false

  const schedule = () => {
    if (closed || inFlight || timer || !queued.length) return
    const urgent = queued.some((q) => q.kind !== 'other')
    const wait = urgent ? 0 : Math.max(0, lastSentAt + minGapMs - now())
    timer = setTimeout(flush, wait)
  }
  const flush = () => {
    timer = null
    if (closed || inFlight || !queued.length) return
    // Keep the latest few if a lot piled up (lap 1 scrambles).
    const batch = queued.slice(-4)
    const dropped = queued.length - batch.length
    queued = []
    inFlight = true
    lastSentAt = now()
    const version = positionVersion
    const urgent = batch.some((q) => q.kind === 'urgent')
    const text = `${dropped ? `(${dropped} earlier events skipped) ` : ''}${batch.map((q) => q.text).join(' ')}`
    engineer
      .notify(text)
      .then((r) => {
        // The order changed while he was thinking: this call is about the old race. The
        // change is queued, so the next check covers it.
        if (version !== positionVersion && !urgent) return
        if (!isSilent(r.text)) opts.onCall?.({ ...r, text: trimCall(r.text) }, { urgent })
      })
      .catch(() => {})
      .finally(() => {
        inFlight = false
        schedule()
      })
  }
  const push = (text: string, kind: Queued['kind'] = 'other') => {
    // Nothing to say on the radio in menus or while paused.
    if (state.snapshot().status !== 'live') return
    // A newer position supersedes an older one that hasn't gone out yet.
    if (kind === 'position') queued = queued.filter((q) => q.kind !== 'position')
    queued.push({ text, kind })
    // Don't make a position change or an emergency wait out the gap between routine checks.
    if (kind !== 'other' && timer) {
      clearTimeout(timer)
      timer = null
    }
    schedule()
  }

  // Position tracking. OVTK events are unreliable (repeats, swaps, pit stops and spins never
  // send one), so diff the timing instead and only count a change once it has held.
  let reported: number | null = null
  let pending: { pos: number; since: number } | null = null
  let safetyCar: string | null = null
  const poll = setInterval(() => {
    if (closed) return
    const s = state.snapshot()
    const sc = s.session?.safetyCar ?? null
    if (s.status === 'live' && sc && sc !== safetyCar) {
      if (safetyCar !== null)
        push(sc === 'None' ? `${safetyCar} ending, green flag soon.` : `${sc} deployed.`, 'urgent')
      safetyCar = sc
    }
    const me = s.cars.find((c) => c.isPlayer)
    if (s.status !== 'live' || !me?.position) return
    // In the pit lane places come and go; judge it once he's back out.
    if (me.pitStatus) return
    const pos = me.position
    if (reported === null) {
      reported = pos
      return
    }
    if (pos === reported) {
      pending = null
      return
    }
    if (!pending || pending.pos !== pos) {
      pending = { pos, since: now() }
      return
    }
    if (now() - pending.since < settleMs) return
    const from = reported
    reported = pos
    pending = null
    positionVersion++
    const name = (p: number) => s.cars.find((c) => c.position === p)?.name
    const ahead = name(pos - 1)
    const behind = name(pos + 1)
    const lost = pos > from
    const n = Math.abs(pos - from)
    const between = (lost ? range(from, pos - 1) : range(pos + 1, from))
      .map(name)
      .filter(Boolean)
      .join(', ')
    opts.onPositionChange?.(from, pos)
    push(
      `Position change: P${from} to P${pos} (${lost ? 'lost' : 'gained'} ${n}${between ? `, ${lost ? 'passed by' : 'passed'} ${between}` : ''}). Car ahead now ${ahead ?? 'none, leading'}, behind ${behind ?? 'none'}. Earlier plans about the old order no longer apply.`,
      'position',
    )
  }, pollMs)

  const offSession = state.on('sessionStarted', () => {
    // A restart or a new session: whatever was queued is about the old one.
    queued = []
    reported = null
    pending = null
    safetyCar = null
    const s = state.snapshot().session
    queued.push({
      text: `New session started${s ? ` (${s.track} ${s.sessionType})` : ''}: a restart or a new session. Laps, positions and gaps from before no longer apply.`,
      kind: 'other',
    })
  })

  const offLap = state.on('lapCompleted', (l) => {
    if (!l.isPlayer) return
    // Rounded to the tenth here: given milliseconds, the model reads them all out.
    push(
      `Lap ${l.lapNumber} done: ${formatLapTime(Math.round(l.lapTimeMs / 100) * 100).replace(/(\.\d)00$/, '$1')}${l.valid ? '' : ' (invalid)'}, P${l.position}.`,
    )
  })

  const offEvent = state.on('event', (e) => {
    const d = e.details
    if (d.code === 'PENA' && 'penaltyType' in d) {
      const me = state.snapshot().cars.find((c) => c.isPlayer)
      // Warnings and lap invalidations come every few corners; the game shows those itself.
      if (
        !me ||
        d.vehicleIdx !== me.carIdx ||
        d.penaltyType === 5 ||
        (d.penaltyType >= 10 && d.penaltyType <= 15)
      )
        return
      const type = PENALTY_TYPES[d.penaltyType] ?? `penalty type ${d.penaltyType}`
      const why = INFRINGEMENT_TYPES[d.infringementType] ?? `infringement ${d.infringementType}`
      const secs = d.penaltyType === 4 || d.penaltyType === 1 ? ` (${d.time}s)` : ''
      // Stop-go and drive-through need action from him; time penalties can wait for a straight.
      push(`Penalty: ${type}${secs} for ${why}.`, d.penaltyType <= 1 ? 'urgent' : 'other')
      return
    }
    if ((d.code === 'SGSV' || d.code === 'DTSV') && 'vehicleIdx' in d) {
      const me = state.snapshot().cars.find((c) => c.isPlayer)
      if (me && d.vehicleIdx === me.carIdx)
        push(d.code === 'SGSV' ? 'Stop-go penalty served.' : 'Drive-through penalty served.')
      return
    }
  })

  return () => {
    closed = true
    if (timer) clearTimeout(timer)
    clearInterval(poll)
    offSession()
    offLap()
    offEvent()
  }
}

/**
 * Automatic calls are one fact and maybe an instruction. The model still runs long now and
 * then, so keep the first two sentences and stop there.
 */
export function trimCall(text: string, maxSentences = 2): string {
  // An ellipsis is a beat, not the end of a sentence.
  const parts = text
    .trim()
    .replace(/\.\.\./g, '\u2026')
    .match(/[^.!?]+(?:[.!?]+(?:\s*<break[^>]*\/>)?|$)/g)
  if (!parts || parts.length <= maxSentences) return text.trim()
  return parts
    .slice(0, maxSentences)
    .join('')
    .replace(/\s*<break[^>]*\/>\s*$/, '')
    .replace(/\u2026/g, '...')
    .trim()
}

export function isSilent(text: string): boolean {
  return text.trim().replace(/[.\s]/g, '').toLowerCase() === SILENT.replace(/[.\s]/g, '')
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
