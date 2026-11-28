import type { CompletedLapTrace, LapTrace } from '@gp/history'
import { TypedEmitter } from '@gp/shared'
import type { RaceState } from '@gp/telemetry'
import { describe, expect, it } from 'vitest'
import { LapCoach, lossLine, tenths } from '../src/lap-coach.ts'
import { DEFAULT_RADIO_PREFS, type RadioPrefs } from '../src/persona.ts'

/** A straight, one corner at 1000 m (min `minKph`), braking from `brakeAt`, another straight. */
function trace(minKph: number, brakeAt: number, lap = 1): LapTrace {
  const t: LapTrace = { lap, binM: 20, speed: [], throttle: [], brake: [], gear: [] }
  for (let m = 0; m < 2000; m += 20) {
    let v = 300
    if (m >= brakeAt && m <= 1000) v = 300 - ((300 - minKph) * (m - brakeAt)) / (1000 - brakeAt)
    else if (m > 1000 && m < 1300) v = minKph + ((300 - minKph) * (m - 1000)) / 300
    t.speed.push(Math.round(v))
    t.brake.push(m >= brakeAt && m < 1000 ? 100 : 0)
    t.throttle.push(m >= brakeAt && m < 1060 ? 0 : 100)
    t.gear.push(v > 200 ? 8 : 4)
  }
  return t
}

class FakeState extends TypedEmitter<Record<string, unknown>> {
  sessionType = 'Race'
  dist = 0
  lap = 3
  inputs = { throttle: 1, brake: 0, steer: 0, speedKph: 290 }
  gapAhead = 3000
  safetyCar = 'None'
  playerInputs() {
    return this.inputs
  }
  snapshot() {
    return {
      status: 'live',
      session: {
        sessionType: this.sessionType,
        trackId: 7,
        totalLaps: 30,
        safetyCar: this.safetyCar,
      },
      cars: [
        {
          isPlayer: true,
          position: 4,
          pitStatus: 0,
          driverStatus: 1,
          deltaToCarInFrontMs: this.gapAhead,
          lapDistanceM: this.dist,
          currentLap: this.lap,
        },
      ],
    }
  }
}

function setup(prefs: Partial<RadioPrefs> = {}) {
  const state = new FakeState()
  let t = 0
  let last: CompletedLapTrace & { trackId: number } = {
    lap: 0,
    lapMs: 0,
    valid: true,
    flashback: false,
    trace: trace(120, 880),
    trackId: 7,
  }
  const said: string[] = []
  const context: string[] = []
  let idle = true
  const ref = { trackId: 7, lapMs: 80_000, trace: trace(120, 880, 99) }
  const coach = new LapCoach({
    state: state as unknown as RaceState,
    lastLap: () => last,
    sessionBest: () => ref,
    storedBest: () => null,
    locate: () => 'corner 6',
    canTalk: () => idle,
    say: (s) => said.push(s),
    addContext: (c) => context.push(c),
    prefs: () => ({ ...DEFAULT_RADIO_PREFS, ...prefs }),
    now: () => t,
  })
  /** Finish lap `n` with this trace and lap time. */
  const finish = (
    n: number,
    tr: LapTrace,
    lapMs: number,
    extra: Partial<CompletedLapTrace> = {},
  ) => {
    last = {
      lap: n,
      lapMs,
      valid: true,
      flashback: false,
      trace: { ...tr, lap: n },
      trackId: 7,
      ...extra,
    }
    state.lap = n + 1
    return coach.lapDone(n)
  }
  /** Drive along for `ms` at distance `dist`, ticking like the real 10 Hz timer. */
  const drive = (dist: number, ms = 600) => {
    state.dist = dist
    let spoke = false
    for (let i = 0; i < ms / 100; i++) {
      t += 100
      spoke = coach.tick() || spoke
    }
    return spoke
  }
  return {
    state,
    coach,
    said,
    context,
    finish,
    drive,
    setIdle: (v: boolean) => {
      idle = v
    },
    advance: (ms: number) => {
      t += ms
    },
  }
}

const early = trace(110, 820)

describe('LapCoach', () => {
  it('names the corner, the loss and the fix, and waits for a long straight', () => {
    const c = setup()
    // One big loss on its own is enough.
    const call = c.finish(3, early, 80_600)
    expect(call?.text).toMatch(/^Corner 6, losing .+ tenths?\. Brake 60 metres later\.$/)
    // Braking zone: not a word.
    c.state.inputs = { throttle: 0, brake: 1, steer: 0.3, speedKph: 150 }
    expect(c.drive(900)).toBe(false)
    // Flat out, but the brakes are a second away: still waiting.
    c.state.inputs = { throttle: 1, brake: 0, steer: 0, speedKph: 300 }
    expect(c.drive(820)).toBe(false)
    // A proper straight: said, once, and the engineer hears about it.
    expect(c.drive(1400)).toBe(true)
    expect(c.said).toEqual([call!.text])
    expect(c.context[0]).toContain(call!.text)
    expect(c.drive(1400)).toBe(false)
  })

  it('needs a repeat for a smaller loss', () => {
    const c = setup()
    const small = trace(116, 860)
    expect(c.finish(3, small, 80_250)).toBeNull()
    expect(c.finish(4, small, 80_250)?.kind).toBe('loss')
  })

  it("doesn't talk over other radio and drops the call once it's stale", () => {
    const c = setup()
    c.finish(3, early, 80_600)
    c.setIdle(false)
    expect(c.drive(1400)).toBe(false)
    c.advance(80_000)
    c.setIdle(true)
    expect(c.drive(1400)).toBe(false)
    expect(c.said).toEqual([])
  })

  it('says so when he fixes the corner it called', () => {
    const c = setup()
    c.finish(3, early, 80_600)
    c.drive(1400)
    const call = c.finish(4, trace(120, 880), 80_050)
    expect(call?.text).toBe('Better through corner 6. Keep that.')
    c.drive(1400)
    expect(c.said).toHaveLength(2)
  })

  it('skips laps that tell us nothing', () => {
    const c = setup()
    c.state.gapAhead = 400
    c.drive(1000)
    // Right behind someone through the corner: dirty air, not his driving.
    expect(c.finish(3, early, 80_600)).toBeNull()
    c.state.gapAhead = 3000
    expect(c.finish(4, early, 80_600, { valid: false })).toBeNull()
    expect(c.finish(5, early, 80_600, { flashback: true })).toBeNull()
    // Faster than the reference: the PB call has it.
    expect(c.finish(6, early, 79_000)).toBeNull()
    c.state.safetyCar = 'Virtual Safety Car'
    c.drive(500)
    c.state.safetyCar = 'None'
    expect(c.finish(7, early, 80_600)).toBeNull()
    expect(c.finish(8, early, 80_600)).not.toBeNull()
  })

  it('stays off in qualifying, on lap 1 and when he turned it off', () => {
    const q = setup()
    q.state.sessionType = 'Q1'
    expect(q.finish(3, early, 80_600)).toBeNull()
    expect(setup().finish(1, early, 80_600)).toBeNull()
    expect(setup({ timeLossCalls: false }).finish(3, early, 80_600)).toBeNull()
    const p = setup()
    p.state.sessionType = 'P1'
    expect(p.finish(1, early, 80_600)).not.toBeNull()
  })

  it("doesn't nag about the same corner every lap", () => {
    const c = setup()
    c.finish(3, early, 80_600)
    c.drive(1400)
    expect(c.finish(4, early, 80_600)).toBeNull()
    expect(c.finish(5, early, 80_600)).toBeNull()
    expect(c.finish(6, early, 80_600)?.kind).toBe('loss')
  })
})

describe('lossLine', () => {
  const base = {
    corner: 1,
    atM: 1000,
    minKph: 120,
    refMinKph: 120,
    brakeLaterM: 0,
    throttleLaterM: 0,
    timeMs: 230,
  }
  it('keeps to one fact and one instruction', () => {
    expect(lossLine('corner 4', { ...base, brakeLaterM: -12 })).toBe(
      'Corner 4, losing two tenths. Brake 10 metres later.',
    )
    expect(lossLine('corner 4', { ...base, minKph: 110 })).toBe(
      'Corner 4, losing two tenths. Carry more speed to the apex.',
    )
    expect(lossLine('corner 4', { ...base, brakeLaterM: 15, minKph: 110 })).toBe(
      'Corner 4, losing two tenths. Braking too deep, it costs the exit.',
    )
    expect(lossLine('corner 4', { ...base, throttleLaterM: 30 })).toBe(
      'Corner 4, losing two tenths. Earlier on the throttle out of there.',
    )
    for (const l of [lossLine('corner 12', { ...base, brakeLaterM: -40 })])
      expect(l.split(' ').length).toBeLessThanOrEqual(12)
  })
  it('speaks the time in words', () => {
    expect(tenths(140)).toBe('a tenth')
    expect(tenths(480)).toBe('half a second')
    expect(tenths(720)).toBe('seven tenths')
  })
})
