export interface DriverInputs {
  throttle: number
  brake: number
  /** -1..1 */
  steer: number
  speedKph: number
}

export interface CornerGateOptions {
  /** Inputs have to look like a straight for this long before it counts. */
  holdMs?: number
  now?: () => number
}

/**
 * Real engineers talk on the straights. This says whether the driver is on one right now:
 * flat out, off the brakes, wheel nearly straight, for a moment. Anything else (braking,
 * turning in, feathering the throttle) is a corner and the radio keeps quiet.
 */
export class CornerGate {
  private straightSince: number | null = null
  private readonly holdMs: number
  private readonly now: () => number

  constructor(opts: CornerGateOptions = {}) {
    this.holdMs = opts.holdMs ?? 300
    this.now = opts.now ?? (() => performance.now())
  }

  static looksStraight(i: DriverInputs): boolean {
    return i.throttle >= 0.9 && i.brake < 0.05 && Math.abs(i.steer) < 0.12 && i.speedKph > 100
  }

  /** Feed the latest inputs; returns true when it's fine to talk. */
  update(inputs: DriverInputs | null): boolean {
    const t = this.now()
    if (!inputs || !CornerGate.looksStraight(inputs)) {
      this.straightSince = null
      return false
    }
    this.straightSince ??= t
    return t - this.straightSince >= this.holdMs
  }
}
