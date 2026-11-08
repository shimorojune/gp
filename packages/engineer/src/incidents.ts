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

export class IncidentDetector {
  private spinSince: number | null = null
  private lastSpinAt = Number.NEGATIVE_INFINITY
  private speeds: { t: number; kph: number }[] = []
  private lastImpactAt = Number.NEGATIVE_INFINITY
  private damage: Partial<Record<string, number | boolean>> | null = null
  /** Set by a collision event with another car, so the impact isn't called a wall hit. */
  private contactAt = Number.NEGATIVE_INFINITY
  private contactWith: string | null = null

  constructor(
    private readonly opts = {
      /** Slip angle (heading vs travel) that counts as a spin, degrees. */
      spinAngleDeg: 70,
      spinMinKph: 30,
      spinHoldMs: 250,
      /** Speed lost within impactWindowMs that counts as a hit. */
      // ~7g: harder than any braking zone in F1 23 (peaks around 5-6g).
      impactDropKph: 100,
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
  }

  update(s: IncidentSample): string[] {
    const out: string[] = []
    const o = this.opts

    // Spin: the car points well away from where it is going, at speed.
    if (s.localVx !== null && s.localVz !== null) {
      const v = Math.hypot(s.localVx, s.localVz) * 3.6
      const slip = Math.abs((Math.atan2(s.localVx, s.localVz) * 180) / Math.PI)
      if (v > o.spinMinKph && slip > o.spinAngleDeg) {
        this.spinSince ??= s.t
        if (s.t - this.spinSince >= o.spinHoldMs && s.t - this.lastSpinAt > o.cooldownMs) {
          this.lastSpinAt = s.t
          out.push(`He spun at ${Math.round(v)} kph.`)
        }
      } else this.spinSince = null
    }

    // Impact: a big speed loss in a fraction of a second (brakes can't do that), or new damage.
    this.speeds.push({ t: s.t, kph: s.speedKph })
    while (this.speeds.length && s.t - this.speeds[0]!.t > o.impactWindowMs) this.speeds.shift()
    const peak = Math.max(...this.speeds.map((x) => x.kph))
    // A spin scrubs speed fast too; that's not an impact unless something broke.
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
        `${what}${hardStop ? `, ${Math.round(peak)} to ${Math.round(s.speedKph)} kph` : ''}.${newDamage.length ? ` Damage: ${newDamage.join(', ')}.` : ' No new damage reported.'}`,
      )
    }
    return out
  }
}
