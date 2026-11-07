import { TypedEmitter } from '@gp/shared'
import type { RaceState } from '@gp/telemetry'
import { describe, expect, it } from 'vitest'
import { attachRadio } from '../src/radio.ts'
import type { EngineerSession, Reply } from '../src/session.ts'

class FakeState extends TypedEmitter<Record<string, unknown>> {
  position = 7
  fire(name: string, payload: unknown) {
    this.emit(name, payload)
  }
  snapshot() {
    return {
      status: 'live',
      session: { track: 'Brazil', sessionType: 'Race' },
      cars: [
        { carIdx: 0, name: 'ROHIT', isPlayer: true, position: this.position },
        { carIdx: 3, name: 'NORRIS', isPlayer: false, position: 8 },
      ],
    }
  }
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

function setup() {
  const state = new FakeState()
  const sent: string[] = []
  const engineer = {
    notify: async (text: string) => {
      sent.push(text)
      await tick(5)
      return { text: 'copy' } as Reply
    },
  } as unknown as EngineerSession
  const stop = attachRadio(state as unknown as RaceState, engineer, { minGapMs: 30, settleMs: 5 })
  return { state, sent, stop }
}

const ovtk = (passer: number, passed: number) => ({
  code: 'OVTK',
  details: { code: 'OVTK', overtakingVehicleIdx: passer, beingOvertakenVehicleIdx: passed },
})

describe('attachRadio', () => {
  it('dedupes repeated overtakes', async () => {
    const { state, sent, stop } = setup()
    state.fire('event', ovtk(0, 3))
    state.fire('event', ovtk(0, 3))
    state.position = 6
    await tick(60)
    expect(sent).toEqual(['Overtake: we passed NORRIS.'])
    stop()
  })

  it('batches events that arrive while a check is in flight', async () => {
    const { state, sent, stop } = setup()
    state.fire('lapCompleted', {
      isPlayer: true,
      lapNumber: 1,
      lapTimeMs: 75000,
      valid: true,
      position: 7,
    })
    await tick(1)
    state.fire('lapCompleted', {
      isPlayer: true,
      lapNumber: 2,
      lapTimeMs: 74000,
      valid: true,
      position: 7,
    })
    state.fire('lapCompleted', {
      isPlayer: false,
      lapNumber: 2,
      lapTimeMs: 74000,
      valid: true,
      position: 8,
    })
    state.fire('lapCompleted', {
      isPlayer: true,
      lapNumber: 3,
      lapTimeMs: 73900,
      valid: false,
      position: 7,
    })
    await tick(80)
    expect(sent).toHaveLength(2)
    expect(sent[1]).toBe('Lap 2 done: 1:14.000, P7. Lap 3 done: 1:13.900 (invalid), P7.')
    stop()
  })

  it('announces a new session and drops events queued for the old one', async () => {
    const { state, sent, stop } = setup()
    state.fire('lapCompleted', {
      isPlayer: true,
      lapNumber: 1,
      lapTimeMs: 75000,
      valid: true,
      position: 7,
    })
    await tick(1)
    state.fire('lapCompleted', {
      isPlayer: true,
      lapNumber: 2,
      lapTimeMs: 74000,
      valid: true,
      position: 7,
    })
    state.fire('sessionStarted', { uid: '2' })
    await tick(80)
    expect(sent).toHaveLength(2)
    expect(sent[1]).toMatch(/^New session started \(Brazil Race\)/)
    stop()
  })
})

describe('attachRadio when not live', () => {
  it('stays quiet in menus and while paused', async () => {
    const { state, sent, stop } = setup()
    const snap = state.snapshot.bind(state)
    state.snapshot = () => ({ ...snap(), status: 'no-data' })
    state.fire('lapCompleted', {
      isPlayer: true,
      lapNumber: 1,
      lapTimeMs: 75000,
      valid: true,
      position: 7,
    })
    await tick(50)
    expect(sent).toEqual([])
    stop()
  })
})

describe('attachRadio penalties', () => {
  it('reports stop-go and time penalties, skips warnings, reports serving', async () => {
    const { state, sent, stop } = setup()
    const pena = (penaltyType: number, infringementType: number, time: number) => ({
      code: 'PENA',
      details: {
        code: 'PENA',
        penaltyType,
        infringementType,
        vehicleIdx: 0,
        otherVehicleIdx: 8,
        time,
        lapNum: 6,
        placesGained: 0,
      },
    })
    state.fire('event', pena(5, 27, 0))
    state.fire('event', pena(1, 3, 5))
    await tick(1)
    state.fire('event', pena(4, 21, 3))
    state.fire('event', { code: 'SGSV', details: { code: 'SGSV', vehicleIdx: 0 } })
    await tick(80)
    expect(sent).toEqual([
      'Penalty: stop go (5s) for big collision.',
      'Penalty: time penalty (3s) for multiple warnings. Stop-go penalty served.',
    ])
    stop()
  })
})
