import { TypedEmitter } from '@gp/shared'
import type { RaceState } from '@gp/telemetry'
import { describe, expect, it } from 'vitest'
import { attachRadio, trimCall } from '../src/radio.ts'
import type { EngineerSession, Reply } from '../src/session.ts'

class FakeState extends TypedEmitter<Record<string, unknown>> {
  position = 7
  latestMotionEx = null
  playerCarIndex = 0
  playerInputs() {
    return { throttle: 1, brake: 0, steer: 0, speedKph: 200 }
  }
  fire(name: string, payload: unknown) {
    this.emit(name, payload)
  }
  snapshot() {
    return {
      status: 'live',
      session: { track: 'Brazil', sessionType: 'Race' },
      cars: [
        { carIdx: 0, name: 'ROHIT', isPlayer: true, position: this.position, pitStatus: 0 },
        { carIdx: 3, name: 'NORRIS', isPlayer: false, position: this.position === 7 ? 8 : 7 },
        { carIdx: 4, name: 'SAINZ', isPlayer: false, position: this.position === 9 ? 8 : 9 },
        { carIdx: 5, name: 'ALONSO', isPlayer: false, position: 6 },
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
  const changes: string[] = []
  const stop = attachRadio(state as unknown as RaceState, engineer, {
    minGapMs: 30,
    settleMs: 20,
    pollMs: 5,
    onPositionChange: (a, b) => changes.push(`${a}>${b}`),
  })
  return { state, sent, stop, changes }
}

describe('attachRadio', () => {
  it('reports a position change once it has held, with who is around us now', async () => {
    const { state, sent, stop, changes } = setup()
    await tick(20)
    state.position = 9
    await tick(80)
    expect(changes).toEqual(['7>9'])
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatch(/^Position change: P7 to P9 \(lost 2, passed by NORRIS, SAINZ\)/)
    expect(sent[0]).toContain('Car ahead now SAINZ')
    stop()
  })

  it('ignores a position that flips straight back', async () => {
    const { state, sent, stop } = setup()
    await tick(20)
    state.position = 8
    await tick(8)
    state.position = 7
    await tick(80)
    expect(sent).toEqual([])
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
    expect(sent[1]).toBe('Lap 2 done: 1:14.0, P7. Lap 3 done: 1:13.9 (invalid), P7.')
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

describe('trimCall', () => {
  it('keeps at most two sentences, pause tags included', () => {
    expect(
      trimCall(
        'Good lap. <break time="0.3s" /> One thirteen four. Stroll is two tenths up the road. Keep going.',
      ),
    ).toBe('Good lap. <break time="0.3s" /> One thirteen four.')
    expect(trimCall('Sainz ahead now... three tenths. Go.')).toBe(
      'Sainz ahead now... three tenths. Go.',
    )
  })
})
