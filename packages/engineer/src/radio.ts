import { formatLapTime } from '@gp/shared'
import { INFRINGEMENT_TYPES, PENALTY_TYPES, type RaceState } from '@gp/telemetry'
import { SILENT } from './persona.ts'
import type { EngineerSession, Reply } from './session.ts'

export interface RadioOptions {
  /** Called with each radio call the engineer decides to make (not silent ones). */
  onCall?: (reply: Reply) => void
  /** Minimum gap between automatic checks, in ms of wall time. Events in between are batched. */
  minGapMs?: number
  /** Wait this long after an overtake before reporting, so LapData positions have caught up. */
  settleMs?: number
  now?: () => number
}

/**
 * Feeds race events to the engineer as [event] turns (which run on the cheap check model).
 * Events are batched: at most one check in flight, at least `minGapMs` apart, and anything
 * that happens meanwhile goes into the next check as one message.
 * Phase 5 replaces this with deterministic callouts and an attention budget.
 */
export function attachRadio(state: RaceState, engineer: EngineerSession, opts: RadioOptions = {}) {
  const minGapMs = opts.minGapMs ?? 8000
  const settleMs = opts.settleMs ?? 1500
  const now = opts.now ?? Date.now
  let queued: string[] = []
  let inFlight = false
  let lastSentAt = Number.NEGATIVE_INFINITY
  let timer: ReturnType<typeof setTimeout> | null = null
  let closed = false

  const schedule = () => {
    if (closed || inFlight || timer || !queued.length) return
    const wait = Math.max(0, lastSentAt + minGapMs - now())
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
    const text = `${dropped ? `(${dropped} earlier events skipped) ` : ''}${batch.join(' ')}`
    engineer
      .notify(text)
      .then((r) => {
        if (!isSilent(r.text)) opts.onCall?.(r)
      })
      .catch(() => {})
      .finally(() => {
        inFlight = false
        schedule()
      })
  }
  const push = (text: string) => {
    // Nothing to say on the radio in menus or while paused.
    if (state.snapshot().status !== 'live') return
    queued.push(text)
    schedule()
  }

  // The game repeats OVTK for the same pair (and cars swap back and forth); one per pair per 20s.
  const seenOvertakes = new Map<string, number>()

  const offSession = state.on('sessionStarted', () => {
    // A restart or a new session: whatever was queued is about the old one.
    queued = []
    seenOvertakes.clear()
    const s = state.snapshot().session
    queued.push(
      `New session started${s ? ` (${s.track} ${s.sessionType})` : ''}: a restart or a new session. Laps, positions and gaps from before no longer apply.`,
    )
  })

  const offLap = state.on('lapCompleted', (l) => {
    if (!l.isPlayer) return
    push(
      `Lap ${l.lapNumber} done: ${formatLapTime(l.lapTimeMs)}${l.valid ? '' : ' (invalid)'}, P${l.position}.`,
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
      push(`Penalty: ${type}${secs} for ${why}.`)
      return
    }
    if ((d.code === 'SGSV' || d.code === 'DTSV') && 'vehicleIdx' in d) {
      const me = state.snapshot().cars.find((c) => c.isPlayer)
      if (me && d.vehicleIdx === me.carIdx)
        push(d.code === 'SGSV' ? 'Stop-go penalty served.' : 'Drive-through penalty served.')
      return
    }
    if (d.code !== 'OVTK' || !('overtakingVehicleIdx' in d)) return
    const me = state.snapshot().cars.find((c) => c.isPlayer)
    if (!me) return
    const passer = d.overtakingVehicleIdx
    const passed = d.beingOvertakenVehicleIdx
    if (passer !== me.carIdx && passed !== me.carIdx) return
    const key = `${passer}>${passed}`
    const t = now()
    if (t - (seenOvertakes.get(key) ?? Number.NEGATIVE_INFINITY) < 20_000) return
    seenOvertakes.set(key, t)
    // Positions in LapData lag the event; read them after a moment.
    setTimeout(() => {
      if (closed) return
      const s = state.snapshot()
      const name = (idx: number) => s.cars.find((c) => c.carIdx === idx)?.name ?? `car ${idx}`
      // No position here: the event and LapData disagree for a moment; the engineer reads timing.
      push(
        passer === me.carIdx
          ? `Overtake: we passed ${name(passed)}.`
          : `Lost a place: ${name(passer)} passed us.`,
      )
    }, settleMs)
  })

  return () => {
    closed = true
    if (timer) clearTimeout(timer)
    offSession()
    offLap()
    offEvent()
  }
}

export function isSilent(text: string): boolean {
  return text.trim().replace(/[.\s]/g, '').toLowerCase() === SILENT.replace(/[.\s]/g, '')
}
