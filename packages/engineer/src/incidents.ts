/**
 * Spots spins and impacts from the player's own car data, so the engineer hears about them
 * live. Pure: feed it samples, it returns event lines.
 */

export interface IncidentSample {
  /** ms, any monotonic clock. */
  t: number
  speedKph: number
  /** Car-local velocity, m/s: x = sideways, z = forwards (MotionEx). */
  localVx: number | null
  localVz: number | null
  /** Where and how he was driving, for the location and the cause. */
  lapDistanceM?: number
  throttle?: number
  brake?: number
  gear?: number
  /** On a lap and out of the pits (driverStatus flying/out/in/on track, not pitting). */
  onLap?: boolean
  /** 0-100 per part; null when no damage packet yet. */
  damage: Partial<Record<string, number | boolean>> | null
}

const DAMAGE_LABEL: Record<string, string> = {
  frontLeftWing: 'front wing (left)',
  frontRightWing: 'front wing (right)',
  rearWing: 'rear wing',
  floor: 'floor',
  diffuser: 'diffuser',
  sidepod: 'sidepod',
}

export interface IncidentMemory {
  add(kind: string, atM: number): void
  near(atM: number): { session: number; total: number; sessions: number }
}

export class IncidentDetector {
  private spinSince: number | null = null
  private lastSpinAt = Number.NEGATIVE_INFINITY
  private speeds: { t: number; kph: number }[] = []
  private lastImpactAt = Number.NEGATIVE_INFINITY
  private damage: Partial<Record<string, number | boolean>> | null = null
  /** Set by a collision event with another car, so the impact isn't called a wall hit. */
  private contactAt = Number.NEGATIVE_INFINITY
  private contactWith: string | null = null

  /** Where earlier incidents this session happened, metres into the lap. */
  private spots: { d: number; t: number }[] = []
  /** Recent samples: the inputs ~0.5 s before an incident say more than those during it. */
  private history: IncidentSample[] = []
  private lastInputs: IncidentSample | null = null
  private lastFastAt = Number.NEGATIVE_INFINITY
  private slideStart: IncidentSample | null = null
  private slideLastAt = Number.NEGATIVE_INFINITY
  private bigSlideAt = Number.NEGATIVE_INFINITY
  private hardStopAt = Number.NEGATIVE_INFINITY

  constructor(
    /** Names a spot on the lap, e.g. "corner 4". */
    private readonly locate: (lapDistanceM: number) => string | null = () => null,
    /**
     * Remembers incidents beyond this detector (the history DB) and says how many came before
     * at this spot. Without it, repeats are counted within this run of the app only.
     */
    private readonly memory: IncidentMemory | null = null,
    private readonly opts = {
      /** Slip angle (heading vs travel) that counts as a spin, degrees. */
      // Tuned on Rohit's Sakhir practice: normal driving peaks at ~24 deg, his spins pass
      // 40 deg while still above 15 kph.
      spinAngleDeg: 40,
      spinMinKph: 15,
      spinHoldMs: 300,
      /** Speed lost within impactWindowMs that counts as a hit. */
      // Hardest braking seen: ~51 kph in 400 ms. Lifts and corners: under 46.
      impactDropKph: 75,
      impactWindowMs: 400,
      /** New damage on any part, percentage points. */
      damageStep: 5,
      cooldownMs: 8000,
    },
  ) {}

  contact(t: number, otherName: string): void {
    this.contactAt = t
    this.contactWith = otherName
  }

  reset(): void {
    this.spinSince = null
    this.speeds = []
    this.damage = null
    this.spots = []
    this.history = []
  }

  /** "at corner 4 (1240 m)... third time at this spot this session". */
  private where(s: IncidentSample, kind: string): string {
    const d = s.lapDistanceM
    if (d === undefined || d < 0) return ''
    const name = this.locate(d)
    // A spin into the wall is one incident, not two: only count earlier, separate ones.
    const local = this.spots.filter((x) => Math.abs(x.d - d) < 150 && s.t - x.t > 5000).length
    const merged = this.spots.some((x) => Math.abs(x.d - d) < 150 && s.t - x.t <= 5000)
    this.spots.push({ d, t: s.t })
    const past = this.memory?.near(d) ?? null
    if (!merged) this.memory?.add(kind, d)
    const repeats = past ? past.session : local
    const how: string[] = []
    if (s.throttle !== undefined) how.push(`throttle ${Math.round(s.throttle * 100)}%`)
    if (s.brake !== undefined) how.push(`brake ${Math.round(s.brake * 100)}%`)
    if (s.gear !== undefined && s.gear > 0) how.push(`gear ${s.gear}`)
    const nth = ['', 'Second', 'Third', 'Fourth'][repeats] ?? `${repeats + 1}th`
    const cause = this.slideStart
      ? ` The slide began at ${Math.round(this.slideStart.speedKph)} kph on ${Math.round((this.slideStart.throttle ?? 0) * 100)}% throttle, ${Math.round((this.slideStart.brake ?? 0) * 100)}% brake${how.length ? `; then ${how.join(', ')}` : ''}.`
      : how.length
        ? ` Inputs just before: ${how.join(', ')}.`
        : ''
    const before =
      past && past.total > past.session
        ? ` ${past.total - past.session} earlier at this spot in ${past.sessions - (past.session ? 1 : 0)} other session(s) here.`
        : ''
    return ` Where: ${name ? `${name}, ` : ''}${Math.round(d)} m into the lap.${cause}${repeats ? ` ${nth} incident at this spot this session: a pattern.` : ''}${before}`
  }

  update(s: IncidentSample): string[] {
    const out: string[] = []
    const o = this.opts
    // A flashback or reset-to-track teleports the car: speed and distance jump with no
    // physics behind it. Start the windows again rather than call it an impact.
    const prev = this.history.at(-1)
    if (
      prev &&
      (s.t - prev.t > 250 ||
        (s.lapDistanceM !== undefined &&
          prev.lapDistanceM !== undefined &&
          Math.abs(s.lapDistanceM - prev.lapDistanceM) > 300))
    ) {
      this.speeds = []
      this.history = []
      this.spinSince = null
      this.lastFastAt = Number.NEGATIVE_INFINITY
      this.slideStart = null
    }
    this.history.push(s)
    while (this.history.length > 1 && s.t - this.history[0]!.t > 600) this.history.shift()
    this.lastInputs = this.history[0] ?? null

    // Spin: the car points well away from where it is going, at speed.
    if (s.localVx !== null && s.localVz !== null) {
      const v = Math.hypot(s.localVx, s.localVz) * 3.6
      const slip = Math.abs((Math.atan2(s.localVx, s.localVz) * 180) / Math.PI)
      // Where the slide began says what caused it (he is usually braking by the time it spins).
      // Below walking pace the angle is noise.
      if (v > 5) {
        if (slip > 15) {
          if (!this.slideStart || s.t - this.slideLastAt > 1500) this.slideStart = s
          this.slideLastAt = s.t
          if (slip > 30) this.bigSlideAt = s.t
        } else if (this.slideStart && s.t - this.slideLastAt > 1500) this.slideStart = null
      }
      if (v > o.spinMinKph && slip > o.spinAngleDeg) {
        this.spinSince ??= s.t
        if (s.t - this.spinSince >= o.spinHoldMs && s.t - this.lastSpinAt > o.cooldownMs) {
          this.lastSpinAt = s.t
          out.push(`He spun at ${Math.round(v)} kph.${this.where(this.lastInputs ?? s, 'spin')}`)
        }
      } else this.spinSince = null
    }

    // Stopped on track mid-lap, fast a moment ago: a spin or off the detector didn't see.
    if (s.speedKph > 40) this.lastFastAt = s.t
    // Only after a real slide or a hard stop: a deliberate stop on an out lap isn't an incident.
    const violent = s.t - this.bigSlideAt < 3000 || s.t - this.hardStopAt < 3000
    if (s.onLap && s.speedKph < 5 && s.t - this.lastFastAt < 3000 && violent) {
      if (s.t - this.lastSpinAt > o.cooldownMs && s.t - this.lastImpactAt > o.cooldownMs) {
        this.lastSpinAt = s.t
        out.push(
          `He has stopped on track (spin or off).${this.where(this.lastInputs ?? s, 'stop')}`,
        )
      }
    }

    // Impact: a big speed loss in a fraction of a second (brakes can't do that), or new damage.
    this.speeds.push({ t: s.t, kph: s.speedKph })
    while (this.speeds.length && s.t - this.speeds[0]!.t > o.impactWindowMs) this.speeds.shift()
    const peak = Math.max(...this.speeds.map((x) => x.kph))
    // A spin scrubs speed fast too; that's not an impact unless something broke.
    if (peak - s.speedKph >= o.impactDropKph) this.hardStopAt = s.t
    const hardStop = peak - s.speedKph >= o.impactDropKph && s.t - this.lastSpinAt > 3000
    const newDamage: string[] = []
    if (s.damage) {
      if (this.damage)
        for (const [k, label] of Object.entries(DAMAGE_LABEL)) {
          const before = Number(this.damage[k] ?? 0)
          const now = Number(s.damage[k] ?? 0)
          if (now - before >= o.damageStep) newDamage.push(`${label} ${Math.round(now)}%`)
        }
      // Only move the baseline when something was reported or nothing changed, so slow
      // creep still adds up to a step.
      if (!this.damage || newDamage.length) this.damage = { ...s.damage }
    }
    if ((hardStop || newDamage.length) && s.t - this.lastImpactAt > o.cooldownMs) {
      this.lastImpactAt = s.t
      this.speeds = []
      const car = s.t - this.contactAt < 2000 ? this.contactWith : null
      const what = car
        ? `Contact with ${car}`
        : hardStop
          ? 'He hit something hard (wall or barrier)'
          : 'New damage'
      out.push(
        `${what}${hardStop ? `, ${Math.round(peak)} to ${Math.round(s.speedKph)} kph` : ''}.${newDamage.length ? ` Damage: ${newDamage.join(', ')}.` : ' No new damage reported.'}${this.where(this.lastInputs ?? s, 'impact')}`,
      )
    }
    return out
  }
}
