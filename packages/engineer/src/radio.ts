import { formatLapTime } from '@gp/shared'
import type { RaceState } from '@gp/telemetry'
import { SILENT } from './persona.ts'
import type { EngineerSession, Reply } from './session.ts'

export interface RadioOptions {
  /** Called with each radio call the engineer decides to make (not silent ones). */
  onCall?: (reply: Reply) => void
}

/**
 * Feeds race events to the engineer as [event] turns (which run on the cheap check model).
 * Phase 2 keeps this minimal: the player's completed laps and overtakes involving the player.
 * Phase 5 replaces it with deterministic callouts and an attention budget.
 */
export function attachRadio(state: RaceState, engineer: EngineerSession, opts: RadioOptions = {}) {
  let inFlight = 0
  const fire = (text: string) => {
    // Don't stack checks: if two are already queued, drop this one. The next lap will catch up.
    if (inFlight >= 2) return
    inFlight++
    engineer
      .notify(text)
      .then((r) => {
        if (!isSilent(r.text)) opts.onCall?.(r)
      })
      .catch(() => {})
      .finally(() => inFlight--)
  }

  const offLap = state.on('lapCompleted', (l) => {
    if (!l.isPlayer) return
    fire(
      `Lap ${l.lapNumber} done: ${formatLapTime(l.lapTimeMs)}${l.valid ? '' : ' (invalid)'}, now P${l.position}.`,
    )
  })
  const offEvent = state.on('event', (e) => {
    const d = e.details
    if (d.code !== 'OVTK' || !('overtakingVehicleIdx' in d)) return
    const s = state.snapshot()
    const me = s.cars.find((c) => c.isPlayer)
    if (!me) return
    const name = (idx: number) => s.cars.find((c) => c.carIdx === idx)?.name ?? `car ${idx}`
    if (d.overtakingVehicleIdx === me.carIdx)
      fire(`Overtake: we passed ${name(d.beingOvertakenVehicleIdx)}, now P${me.position}.`)
    else if (d.beingOvertakenVehicleIdx === me.carIdx)
      fire(`Lost a place: ${name(d.overtakingVehicleIdx)} passed us, now P${me.position}.`)
  })
  return () => {
    offLap()
    offEvent()
  }
}

export function isSilent(text: string): boolean {
  return text.trim().replace(/[.\s]/g, '').toLowerCase() === SILENT.replace(/[.\s]/g, '')
}
