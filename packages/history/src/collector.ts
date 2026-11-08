import {
  CAREER_GAME_MODES,
  type CarSetup,
  type CompletedLap,
  GAME_MODES,
  INFRINGEMENT_TYPES,
  PENALTY_TYPES,
  type Packet,
  PacketId,
  RESULT_STATUS,
  RaceState,
  SESSION_TYPES,
  type SessionHistoryData,
  TEAMS,
  TRACKS,
  VISUAL_COMPOUNDS,
  WEATHER,
} from '@gp/telemetry'

/**
 * 'sim' = simulator time: time trial, one-off Grand Prix, events, online. Feeds track
 * knowledge, setup coaching and the driver profile. 'career' = the real season, kept apart so
 * sim results don't pollute career stats.
 */
export type Program = 'sim' | 'career'

export interface LapRecord {
  lap: number
  lapMs: number
  s1Ms: number
  s2Ms: number
  s3Ms: number
  valid: boolean
  tyre: string | null
  tyreAge: number | null
  fuelKg: number | null
  position: number
  /** Key into SessionRecord.setups; null if the game sent no setup. */
  setupKey: string | null
  /** A flashback was used during this lap. */
  flashback: boolean
}

export interface IncidentRecord {
  lap: number
  kind: 'penalty' | 'warning' | 'flashback' | 'damage' | 'retired' | 'lost_places'
  detail: string
  sessionTime: number
}

/**
 * Speed/throttle/brake/gear per `binM` metres of the lap, for the session's best valid lap
 * only. ~250 bins on a 5 km track: small enough to keep forever, detailed enough to compare
 * corner minimums and braking points between laps.
 */
export interface LapTrace {
  lap: number
  binM: number
  /** kph, rounded; -1 = no sample in this bin */
  speed: number[]
  /** 0-100 */
  throttle: number[]
  /** 0-100, max in the bin */
  brake: number[]
  gear: number[]
}

export interface SessionResult {
  position: number
  grid: number
  points: number
  pitStops: number
  status: string
  raceTimeSec: number
  penaltiesSec: number
}

export interface ClassifiedCar {
  position: number
  name: string
  team: string
  isPlayer: boolean
  grid: number
  points: number
  bestLapMs: number
  status: string
}

export interface SessionRecord {
  uid: string
  startedAt: string
  durationSec: number
  trackId: number
  track: string
  sessionType: string
  gameMode: number
  mode: string
  program: Program
  online: boolean
  weather: string
  trackTempC: number
  airTempC: number
  totalLaps: number
  aiDifficulty: number
  assists: Record<string, number>
  seasonLink: number
  weekendLink: number
  sessionLink: number
  team: string | null
  /** Setup as set at the start of the session; kept out of the setup identity. */
  fuelLoad: number | null
  laps: LapRecord[]
  setups: Record<string, CarSetup>
  bestTrace: LapTrace | null
  result: SessionResult | null
  incidents: IncidentRecord[]
  flashbacks: number
  warnings: number
  cornerCutWarnings: number
  /** Fastest lap by any other driver in the session (not time trial). */
  fieldBestMs: number | null
  teammate: { name: string; bestLapMs: number; position: number; points: number | null } | null
  /** Final classification of the whole field (race and qualifying), when the game sent it. */
  classification: ClassifiedCar[]
  numCars: number
}

const BIN_M = 20

/**
 * Setup identity: everything the driver sets in the garage, minus fuel, and minus brake bias,
 * which he moves on the wheel lap by lap (the setup packet follows it).
 */
export function setupKey(s: CarSetup): string | null {
  const { fuelLoad: _fuel, brakeBias: _bias, ...rest } = s
  if (Object.values(rest).every((v) => v === 0)) return null
  return JSON.stringify(rest)
}

interface TraceAccum {
  lap: number
  speedSum: number[]
  count: number[]
  throttleSum: number[]
  brakeMax: number[]
  gear: number[]
  dirty: boolean
}

function newTrace(lap: number): TraceAccum {
  return { lap, speedSum: [], count: [], throttleSum: [], brakeMax: [], gear: [], dirty: false }
}

function finishTrace(t: TraceAccum): LapTrace {
  const n = t.count.length
  const out: LapTrace = { lap: t.lap, binM: BIN_M, speed: [], throttle: [], brake: [], gear: [] }
  for (let i = 0; i < n; i++) {
    const c = t.count[i] ?? 0
    out.speed.push(c ? Math.round((t.speedSum[i] ?? 0) / c) : -1)
    out.throttle.push(c ? Math.round(((t.throttleSum[i] ?? 0) / c) * 100) : -1)
    out.brake.push(c ? Math.round((t.brakeMax[i] ?? 0) * 100) : -1)
    out.gear.push(c ? (t.gear[i] ?? 0) : -1)
  }
  return out
}

/** One game session's worth of state while folding packets. */
class SessionAccum {
  readonly state: RaceState
  record: SessionRecord | null = null
  firstAt: number
  lastAt: number
  private laps = new Map<number, LapRecord>()
  private setups: Record<string, CarSetup> = {}
  private currentSetup: string | null = null
  private fuelLoad: number | null = null
  private incidents: IncidentRecord[] = []
  private flashbacks = 0
  private flashbackLaps = new Set<number>()
  private playerIdx = 0
  private curLap = 0
  private lapDistance = -1
  private trace: TraceAccum | null = null
  bestTrace: { ms: number; trace: LapTrace } | null = null
  /** Best clean lap trace per setup, for "is the new setup better" in this session. */
  readonly bestBySetup = new Map<string, { ms: number; trace: LapTrace }>()
  private lastDamage = 0
  private result: SessionResult | null = null
  private session: Extract<Packet, { id: PacketId.Session }>['data'] | null = null
  private teamId: number | null = null
  private history: SessionHistoryData | null = null
  private participants: { name: string; teamId: number }[] = []
  private classification: ClassifiedCar[] = []
  private cornerCuts = 0
  private warnings = 0

  constructor(
    readonly uid: string,
    at: number,
    private readonly clock: { now: number },
  ) {
    this.firstAt = at
    this.lastAt = at
    this.state = new RaceState({ now: () => clock.now })
    this.state.on('lapCompleted', (l) => {
      if (l.isPlayer) this.onLap(l)
    })
  }

  feed(p: Packet, at: number): void {
    this.lastAt = at
    this.playerIdx = p.header.playerCarIndex
    this.state.ingest(p)
    switch (p.id) {
      case PacketId.Session:
        this.session = p.data
        break
      case PacketId.Participants:
        this.teamId = p.data.participants[this.playerIdx]?.teamId ?? null
        this.participants = p.data.participants.map((x) => ({ name: x.name, teamId: x.teamId }))
        break
      case PacketId.CarSetups: {
        const s = p.data.cars[this.playerIdx]
        if (!s) break
        const key = setupKey(s)
        if (key) {
          this.setups[key] ??= { ...s }
          this.currentSetup = key
          if (this.fuelLoad === null && s.fuelLoad > 0) this.fuelLoad = s.fuelLoad
        }
        break
      }
      case PacketId.LapData: {
        const l = p.data.cars[this.playerIdx]
        if (!l) break
        this.cornerCuts = l.cornerCuttingWarnings
        this.warnings = l.totalWarnings
        if (l.currentLapNum !== this.curLap) {
          this.curLap = l.currentLapNum
          this.trace = newTrace(l.currentLapNum)
        }
        this.lapDistance = l.lapDistance
        break
      }
      case PacketId.CarTelemetry: {
        const t = p.data.cars[this.playerIdx]
        const tr = this.trace
        if (!t || !tr || tr.dirty || this.lapDistance < 0) break
        const bin = Math.floor(this.lapDistance / BIN_M)
        if (bin > 2000) break
        tr.speedSum[bin] = (tr.speedSum[bin] ?? 0) + t.speed
        tr.count[bin] = (tr.count[bin] ?? 0) + 1
        tr.throttleSum[bin] = (tr.throttleSum[bin] ?? 0) + t.throttle
        tr.brakeMax[bin] = Math.max(tr.brakeMax[bin] ?? 0, t.brake)
        tr.gear[bin] = t.gear
        break
      }
      case PacketId.CarDamage: {
        const d = p.data.cars[this.playerIdx]
        if (!d) break
        const worst = Math.max(
          d.frontLeftWingDamage,
          d.frontRightWingDamage,
          d.rearWingDamage,
          d.floorDamage,
          d.diffuserDamage,
          d.sidepodDamage,
        )
        if (worst >= this.lastDamage + 10) {
          this.incident('damage', `bodywork damage now ${worst}%`, p.header.sessionTime)
        }
        // Repairs (pit stop, flashback) bring it down again.
        if (worst >= this.lastDamage + 10 || worst < this.lastDamage) this.lastDamage = worst
        break
      }
      case PacketId.SessionHistory:
        if (p.data.carIdx === this.playerIdx) this.history = p.data
        break
      case PacketId.Event:
        this.onEvent(p.data, p.header.sessionTime)
        break
      case PacketId.FinalClassification: {
        this.classification = p.data.cars
          .slice(0, p.data.numCars)
          .map((fc, i) => ({
            position: fc.position,
            name: this.participants[i]?.name ?? `Car ${i}`,
            team: TEAMS[this.participants[i]?.teamId ?? 255] ?? 'unknown',
            isPlayer: i === this.playerIdx,
            grid: fc.gridPosition,
            points: fc.points,
            bestLapMs: fc.bestLapTimeInMS,
            status: RESULT_STATUS[fc.resultStatus] ?? `#${fc.resultStatus}`,
          }))
          .filter((c) => c.position > 0)
          .sort((a, b) => a.position - b.position)
        const c = p.data.cars[this.playerIdx]
        if (c && c.position > 0)
          this.result = {
            position: c.position,
            grid: c.gridPosition,
            points: c.points,
            pitStops: c.numPitStops,
            status: RESULT_STATUS[c.resultStatus] ?? `#${c.resultStatus}`,
            raceTimeSec: c.totalRaceTime,
            penaltiesSec: c.penaltiesTime,
          }
        break
      }
    }
  }

  private incident(kind: IncidentRecord['kind'], detail: string, sessionTime: number): void {
    this.incidents.push({ lap: this.curLap, kind, detail, sessionTime })
  }

  private onEvent(e: Extract<Packet, { id: PacketId.Event }>['data'], sessionTime: number): void {
    const d = e.details as unknown as Record<string, number>
    switch (e.code) {
      case 'PENA': {
        if (d.vehicleIdx !== this.playerIdx) break
        const type = d.penaltyType ?? -1
        // Lap invalidations are already on the lap itself; reminders are noise.
        if (type >= 10 && type <= 15) break
        if (type === 3) break
        const what = PENALTY_TYPES[type] ?? `penalty #${type}`
        const why = INFRINGEMENT_TYPES[d.infringementType ?? -1] ?? ''
        const secs = type === 4 && d.time ? ` +${d.time}s` : ''
        this.incident(type === 5 ? 'warning' : 'penalty', `${what}${secs}: ${why}`, sessionTime)
        break
      }
      case 'RTMT':
        if (d.vehicleIdx === this.playerIdx) this.incident('retired', 'retired', sessionTime)
        break
      case 'FLBK':
        this.flashbacks++
        this.flashbackLaps.add(this.curLap)
        // The trace for this lap now mixes two attempts; don't keep it.
        if (this.trace) this.trace.dirty = true
        this.incident('flashback', 'flashback used', sessionTime)
        break
    }
  }

  private onLap(l: CompletedLap): void {
    const rec: LapRecord = {
      lap: l.lapNumber,
      lapMs: l.lapTimeMs,
      s1Ms: l.sector1Ms,
      s2Ms: l.sector2Ms,
      s3Ms: l.sector3Ms,
      valid: l.valid,
      tyre: l.tyreVisual,
      tyreAge: l.tyreAgeLaps,
      fuelKg: l.fuelKg === null ? null : Math.round(l.fuelKg * 10) / 10,
      position: l.position,
      setupKey: this.currentSetup,
      flashback: this.flashbackLaps.has(l.lapNumber),
    }
    // A flashback can replay a lap: the last completion wins.
    this.laps.set(l.lapNumber, rec)
    const tr = this.trace
    if (tr && tr.lap === l.lapNumber && !tr.dirty && l.valid) {
      const done = finishTrace(tr)
      if (!this.bestTrace || l.lapTimeMs < this.bestTrace.ms)
        this.bestTrace = { ms: l.lapTimeMs, trace: done }
      const key = this.currentSetup
      const prev = key ? this.bestBySetup.get(key) : undefined
      if (key && (!prev || l.lapTimeMs < prev.ms))
        this.bestBySetup.set(key, { ms: l.lapTimeMs, trace: done })
    }
  }

  /**
   * The last lap of a race never ticks the lap counter over, so it's missing from the live
   * laps. The game's own lap history has it (and any lap we missed joining mid-session).
   */
  private fillFromHistory(): void {
    const h = this.history
    if (!h) return
    for (let i = 0; i < h.numLaps; i++) {
      const lh = h.lapHistory[i]
      const lap = i + 1
      if (!lh || lh.lapTimeInMS <= 0 || this.laps.has(lap)) continue
      const s1 = lh.sector1TimeMinutes * 60000 + lh.sector1TimeInMS
      const s2 = lh.sector2TimeMinutes * 60000 + lh.sector2TimeInMS
      const s3 = lh.sector3TimeMinutes * 60000 + lh.sector3TimeInMS
      const stint = h.tyreStints
        .slice(0, h.numTyreStints)
        .find((s) => s.endLap === 255 || s.endLap >= lap)
      const prev = this.laps.get(lap - 1)
      this.laps.set(lap, {
        lap,
        lapMs: lh.lapTimeInMS,
        s1Ms: s1,
        s2Ms: s2,
        s3Ms: s3,
        valid: (lh.lapValidBitFlags & 1) === 1,
        tyre: stint ? (VISUAL_COMPOUNDS[stint.tyreVisualCompound] ?? null) : null,
        tyreAge: prev?.tyreAge != null ? prev.tyreAge + 1 : null,
        fuelKg: null,
        position: lap === h.numLaps && this.result ? this.result.position : (prev?.position ?? 0),
        setupKey: this.currentSetup,
        flashback: this.flashbackLaps.has(lap),
      })
    }
  }

  /** Laps so far (in order) with the setups they were driven on, for live comparisons. */
  liveLaps(): { laps: LapRecord[]; setups: Record<string, CarSetup> } {
    return { laps: [...this.laps.values()].sort((a, b) => a.lap - b.lap), setups: this.setups }
  }

  /** Build the record. Null when nothing worth keeping happened (menus, garage only). */
  finish(recordingStartMs: number): SessionRecord | null {
    const s = this.session
    this.fillFromHistory()
    const laps = [...this.laps.values()].sort((a, b) => a.lap - b.lap)
    if (!s || (laps.length === 0 && !this.result)) return null
    const snap = this.state.snapshot()
    const isTT = s.sessionType === 13
    const isRace = s.sessionType >= 10 && s.sessionType <= 12
    if (isRace) {
      for (let i = 1; i < laps.length; i++) {
        const lost = laps[i]!.position - laps[i - 1]!.position
        if (lost >= 2)
          this.incidents.push({
            lap: laps[i]!.lap,
            kind: 'lost_places',
            detail: `P${laps[i - 1]!.position} to P${laps[i]!.position}`,
            sessionTime: 0,
          })
      }
    }
    const others = isTT ? [] : snap.cars.filter((c) => !c.isPlayer)
    const fieldBest = others.map((c) => c.bestLapMs).filter((ms) => ms > 0)
    const mate =
      this.teamId === null || isTT
        ? undefined
        : others.find((c) => c.teamId === this.teamId && c.teamId !== 255)
    const mateCls = mate
      ? this.classification.find((c) => c.name === mate.name && !c.isPlayer)
      : undefined
    return {
      uid: this.uid,
      startedAt: new Date(recordingStartMs + this.firstAt).toISOString(),
      durationSec: Math.round((this.lastAt - this.firstAt) / 1000),
      trackId: s.trackId,
      track: TRACKS[s.trackId] ?? `Track #${s.trackId}`,
      sessionType: SESSION_TYPES[s.sessionType] ?? `#${s.sessionType}`,
      gameMode: s.gameMode,
      mode: GAME_MODES[s.gameMode] ?? `mode #${s.gameMode}`,
      program: CAREER_GAME_MODES.has(s.gameMode) ? 'career' : 'sim',
      online: s.networkGame === 1,
      weather: WEATHER[s.weather] ?? `#${s.weather}`,
      trackTempC: s.trackTemperature,
      airTempC: s.airTemperature,
      totalLaps: s.totalLaps,
      aiDifficulty: s.aiDifficulty,
      assists: {
        steering: s.steeringAssist,
        braking: s.brakingAssist,
        gearbox: s.gearboxAssist,
        pit: s.pitAssist,
        ers: s.ersAssist,
        drs: s.drsAssist,
        racingLine: s.dynamicRacingLine,
      },
      seasonLink: s.seasonLinkIdentifier,
      weekendLink: s.weekendLinkIdentifier,
      sessionLink: s.sessionLinkIdentifier,
      team: this.teamId === null ? null : (TEAMS[this.teamId] ?? `team ${this.teamId}`),
      fuelLoad: this.fuelLoad,
      laps,
      setups: this.setups,
      bestTrace: this.bestTrace?.trace ?? null,
      result: this.result,
      incidents: this.incidents,
      flashbacks: this.flashbacks,
      warnings: this.warnings,
      cornerCutWarnings: this.cornerCuts,
      fieldBestMs: fieldBest.length ? Math.min(...fieldBest) : null,
      teammate: mate
        ? {
            name: mate.name,
            bestLapMs: mate.bestLapMs,
            position: mateCls?.position ?? mate.position,
            points: mateCls?.points ?? null,
          }
        : null,
      classification: this.classification,
      numCars: snap.cars.length,
    }
  }
}

/**
 * Folds a packet stream (live or from a recording) into one SessionRecord per game session.
 * `at` is ms since the recording started; `recordingStartMs` anchors it to wall time.
 */
export class SessionCollector {
  private cur: SessionAccum | null = null
  private done: SessionRecord[] = []
  private readonly clock = { now: 0 }

  constructor(private readonly recordingStartMs: number) {}

  feed(p: Packet, at: number): void {
    // Menus send Event packets with sessionUID 0. They aren't part of any session.
    if (p.header.sessionUID === 0n) return
    this.clock.now = at
    const uid = p.header.sessionUID.toString()
    if (!this.cur || this.cur.uid !== uid) {
      this.flush()
      this.cur = new SessionAccum(uid, at, this.clock)
    }
    this.cur.feed(p, at)
  }

  private flush(): void {
    const r = this.cur?.finish(this.recordingStartMs)
    if (r) this.done.push(r)
    this.cur = null
  }

  /** The current session's best clean lap so far, live (for corner-by-corner comparison). */
  /** The live session's laps, setups and per-setup best traces (null before any session). */
  live(): {
    trackId: number | null
    laps: LapRecord[]
    setups: Record<string, CarSetup>
    bestBySetup: Map<string, { ms: number; trace: LapTrace }>
  } | null {
    const c = this.cur
    if (!c) return null
    return {
      trackId: c.state.snapshot().session?.trackId ?? null,
      ...c.liveLaps(),
      bestBySetup: c.bestBySetup,
    }
  }

  liveBest(): { trackId: number | null; lapMs: number; trace: LapTrace } | null {
    const b = this.cur?.bestTrace
    if (!b) return null
    return {
      trackId: this.cur?.state.snapshot().session?.trackId ?? null,
      lapMs: b.ms,
      trace: b.trace,
    }
  }

  finish(): SessionRecord[] {
    this.flush()
    return this.done
  }
}
