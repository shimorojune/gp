import { TypedEmitter } from '@gp/shared'
import {
  ACTUAL_COMPOUNDS,
  NUM_CARS,
  PacketId,
  SAFETY_CAR_STATUS,
  SESSION_TYPES,
  TRACKS,
  VISUAL_COMPOUNDS,
  WEATHER,
} from './constants.ts'
import type {
  CarDamage,
  CarSetup,
  CarStatus,
  CarTelemetry,
  EventData,
  LapData,
  MotionExData,
  SessionData,
  SessionHistoryData,
  TyreSetsData,
} from './packets.ts'
import type { Packet } from './parse.ts'
import type { Wheels } from './reader.ts'

/**
 * - `no-data`: nothing received recently (game closed, telemetry off, or in menus).
 * - `paused`: we have a session but high-rate packets stopped (pause menu, flashback screen).
 *   The game keeps sending Event packets while paused, so silence is not a disconnect.
 * - `live`: driving.
 */
export type ConnectionStatus = 'no-data' | 'paused' | 'live'

export interface CompletedLap {
  carIdx: number
  lapNumber: number
  lapTimeMs: number
  sector1Ms: number
  sector2Ms: number
  sector3Ms: number
  valid: boolean
  /** Tyre info at the end of the lap (player only; other cars may be restricted). */
  tyreVisual: string | null
  tyreAgeLaps: number | null
  fuelKg: number | null
  /** Race position and gaps as the lap ended (gap trend = are we catching / being caught). */
  position: number
  gapAheadMs: number
  sessionTime: number
}

export interface CarSnapshot {
  carIdx: number
  name: string
  raceNumber: number
  teamId: number
  aiControlled: boolean
  isPlayer: boolean
  position: number
  currentLap: number
  lastLapMs: number
  bestLapMs: number
  currentLapMs: number
  sector: number
  deltaToCarInFrontMs: number
  deltaToLeaderMs: number
  pitStatus: number
  numPitStops: number
  penaltiesSec: number
  driverStatus: number
  resultStatus: number
  tyreVisual: string | null
  tyreActual: string | null
  tyreAgeLaps: number | null
  /** From session history: tyre stints so far (visual compound names, with end laps). */
  stints: { compound: string; endLap: number | null }[]
}

export interface PlayerSnapshot {
  carIdx: number
  speedKph: number
  gear: number
  throttle: number
  brake: number
  steer: number
  rpm: number
  drs: boolean
  drsAllowed: boolean
  tyreWear: Wheels<number>
  tyreSurfaceTemp: Wheels<number>
  tyreInnerTemp: Wheels<number>
  tyrePressure: Wheels<number>
  brakeTemp: Wheels<number>
  fuelKg: number
  /**
   * Fuel margin in laps vs. what the game thinks you need to finish (the MFD fuel delta).
   * +1.4 means 1.4 laps spare, negative means you need to save. NOT laps left in the tank.
   */
  fuelMarginLaps: number
  fuelMix: number
  brakeBias: number
  ersPercent: number
  ersMode: number
  damage: {
    frontLeftWing: number
    frontRightWing: number
    rearWing: number
    floor: number
    diffuser: number
    sidepod: number
    gearbox: number
    engine: number
    drsFault: boolean
    ersFault: boolean
  } | null
  setup: CarSetup | null
  tyreSets: TyreSetsData | null
  laps: CompletedLap[]
  bestLapMs: number
  lapInvalid: boolean
}

export interface SessionSnapshot {
  uid: string
  track: string
  trackId: number
  trackLengthM: number
  sessionType: string
  totalLaps: number
  timeLeftSec: number
  weather: string
  trackTempC: number
  airTempC: number
  safetyCar: string
  pitWindowIdealLap: number
  pitWindowLatestLap: number
  pitRejoinPosition: number
  numSafetyCarPeriods: number
  numVscPeriods: number
  forecast: { inMinutes: number; weather: string; rainPercent: number; trackTempC: number }[]
}

export interface RaceSnapshot {
  status: ConnectionStatus
  sessionTime: number
  session: SessionSnapshot | null
  player: PlayerSnapshot | null
  /** Sorted by race position; cars with position 0 (inactive) are dropped. */
  cars: CarSnapshot[]
  packetsPerSecond: number
}

type RaceStateEvents = {
  status: ConnectionStatus
  sessionStarted: { uid: string }
  lapCompleted: CompletedLap & { isPlayer: boolean }
  event: EventData
}

export interface RaceStateOptions {
  now?: () => number
  /** High-rate packets older than this mean "paused". */
  pausedAfterMs?: number
  /** Nothing at all for this long means "no-data". */
  noDataAfterMs?: number
}

interface CarAccum {
  prevLap: LapData | null
  bestLapMs: number
}

const HIGH_RATE = new Set([PacketId.Motion, PacketId.LapData, PacketId.CarTelemetry])

/**
 * Folds the packet stream into one current view of the session. Holds only the latest packet
 * of each type plus per-lap history; cheap enough to update at 60 Hz.
 */
export class RaceState extends TypedEmitter<RaceStateEvents> {
  private readonly now: () => number
  private readonly pausedAfterMs: number
  private readonly noDataAfterMs: number

  private uid: bigint | null = null
  private playerIdx = 0
  private sessionTime = 0
  private lastAnyAt = Number.NEGATIVE_INFINITY
  private lastHighRateAt = Number.NEGATIVE_INFINITY
  private lastStatus: ConnectionStatus = 'no-data'
  private packetTimes: number[] = []

  private session: SessionData | null = null
  private lap: LapData[] | null = null
  private telemetry: CarTelemetry[] | null = null
  private status: CarStatus[] | null = null
  private damage: CarDamage[] | null = null
  private setups: CarSetup[] | null = null
  private names: { name: string; raceNumber: number; teamId: number; ai: boolean }[] = []
  private history = new Map<number, SessionHistoryData>()
  private tyreSets: TyreSetsData | null = null
  private motionEx: MotionExData | null = null
  private cars: CarAccum[] = []
  private playerLaps: CompletedLap[] = []

  constructor(opts: RaceStateOptions = {}) {
    super()
    this.now = opts.now ?? Date.now
    this.pausedAfterMs = opts.pausedAfterMs ?? 1000
    this.noDataAfterMs = opts.noDataAfterMs ?? 10_000
    this.resetSession()
  }

  private resetSession(): void {
    this.session = null
    this.lap = null
    this.telemetry = null
    this.status = null
    this.damage = null
    this.setups = null
    this.names = []
    this.history.clear()
    this.tyreSets = null
    this.motionEx = null
    this.cars = Array.from({ length: NUM_CARS }, () => ({ prevLap: null, bestLapMs: 0 }))
    this.playerLaps = []
  }

  ingest(packet: Packet): void {
    const at = this.now()
    const { header } = packet
    // Menus send Event packets with sessionUID 0. They aren't part of any session.
    if (header.sessionUID === 0n) return
    if (this.uid !== header.sessionUID) {
      this.uid = header.sessionUID
      this.resetSession()
      this.emit('sessionStarted', { uid: header.sessionUID.toString() })
    }
    this.playerIdx = header.playerCarIndex
    this.sessionTime = header.sessionTime
    this.lastAnyAt = at
    if (HIGH_RATE.has(packet.id)) this.lastHighRateAt = at
    this.packetTimes.push(at)
    if (this.packetTimes.length > 2000) this.packetTimes.splice(0, 1000)

    switch (packet.id) {
      case PacketId.Session:
        this.session = packet.data
        break
      case PacketId.LapData:
        this.ingestLapData(packet.data.cars)
        break
      case PacketId.Event:
        this.emit('event', packet.data)
        break
      case PacketId.Participants:
        this.names = packet.data.participants.map((p) => ({
          name: p.name,
          raceNumber: p.raceNumber,
          teamId: p.teamId,
          ai: p.aiControlled === 1,
        }))
        break
      case PacketId.CarSetups:
        this.setups = packet.data.cars
        break
      case PacketId.CarTelemetry:
        this.telemetry = packet.data.cars
        break
      case PacketId.CarStatus:
        this.status = packet.data.cars
        break
      case PacketId.CarDamage:
        this.damage = packet.data.cars
        break
      case PacketId.SessionHistory:
        this.history.set(packet.data.carIdx, packet.data)
        break
      case PacketId.TyreSets:
        if (packet.data.carIdx === this.playerIdx) this.tyreSets = packet.data
        break
      case PacketId.MotionEx:
        this.motionEx = packet.data
        break
    }
    this.updateStatus()
  }

  private ingestLapData(cars: LapData[]): void {
    this.lap = cars
    for (let i = 0; i < cars.length; i++) {
      const cur = cars[i]!
      const acc = this.cars[i]!
      const prev = acc.prevLap
      acc.prevLap = cur
      if (!prev || cur.resultStatus < 2) continue
      if (cur.currentLapNum === prev.currentLapNum + 1 && cur.lastLapTimeInMS > 0) {
        const s1 = prev.sector1TimeMinutes * 60000 + prev.sector1TimeInMS
        const s2 = prev.sector2TimeMinutes * 60000 + prev.sector2TimeInMS
        const lapMs = cur.lastLapTimeInMS
        const valid = prev.currentLapInvalid === 0
        if (valid && (acc.bestLapMs === 0 || lapMs < acc.bestLapMs)) acc.bestLapMs = lapMs
        const isPlayer = i === this.playerIdx
        const st = this.status?.[i]
        const completed: CompletedLap = {
          carIdx: i,
          lapNumber: prev.currentLapNum,
          lapTimeMs: lapMs,
          sector1Ms: s1,
          sector2Ms: s2,
          sector3Ms: s1 && s2 ? lapMs - s1 - s2 : 0,
          valid,
          tyreVisual: st ? (VISUAL_COMPOUNDS[st.visualTyreCompound] ?? null) : null,
          tyreAgeLaps: st ? st.tyresAgeLaps : null,
          fuelKg: st ? st.fuelInTank : null,
          position: cur.carPosition,
          gapAheadMs: cur.deltaToCarInFrontInMS,
          sessionTime: this.sessionTime,
        }
        if (isPlayer) this.playerLaps.push(completed)
        this.emit('lapCompleted', { ...completed, isPlayer })
      }
    }
  }

  /** Call periodically (e.g. 4 Hz) so status can fall back to paused/no-data with no packets. */
  tick(): ConnectionStatus {
    this.updateStatus()
    return this.lastStatus
  }

  private computeStatus(): ConnectionStatus {
    const now = this.now()
    if (now - this.lastAnyAt > this.noDataAfterMs) return 'no-data'
    if (this.session?.gamePaused === 1) return 'paused'
    if (now - this.lastHighRateAt > this.pausedAfterMs) return this.session ? 'paused' : 'no-data'
    return 'live'
  }

  private updateStatus(): void {
    const status = this.computeStatus()
    if (status !== this.lastStatus) {
      this.lastStatus = status
      this.emit('status', status)
    }
  }

  get playerCarIndex(): number {
    return this.playerIdx
  }

  get latestMotionEx(): MotionExData | null {
    return this.motionEx
  }

  snapshot(): RaceSnapshot {
    const now = this.now()
    const recent = this.packetTimes.filter((t) => now - t <= 1000).length
    return {
      status: this.computeStatus(),
      sessionTime: this.sessionTime,
      session: this.sessionSnapshot(),
      player: this.playerSnapshot(),
      cars: this.carSnapshots(),
      packetsPerSecond: recent,
    }
  }

  private sessionSnapshot(): SessionSnapshot | null {
    const s = this.session
    if (!s || this.uid === null) return null
    const forecast = s.weatherForecastSamples
      .slice(0, s.numWeatherForecastSamples)
      .filter((f) => f.sessionType === s.sessionType)
      .map((f) => ({
        inMinutes: f.timeOffset,
        weather: WEATHER[f.weather] ?? `#${f.weather}`,
        rainPercent: f.rainPercentage,
        trackTempC: f.trackTemperature,
      }))
    return {
      uid: this.uid.toString(),
      track: TRACKS[s.trackId] ?? `Track #${s.trackId}`,
      trackId: s.trackId,
      trackLengthM: s.trackLength,
      sessionType: SESSION_TYPES[s.sessionType] ?? `#${s.sessionType}`,
      totalLaps: s.totalLaps,
      timeLeftSec: s.sessionTimeLeft,
      weather: WEATHER[s.weather] ?? `#${s.weather}`,
      trackTempC: s.trackTemperature,
      airTempC: s.airTemperature,
      safetyCar: SAFETY_CAR_STATUS[s.safetyCarStatus] ?? `#${s.safetyCarStatus}`,
      pitWindowIdealLap: s.pitStopWindowIdealLap,
      pitWindowLatestLap: s.pitStopWindowLatestLap,
      pitRejoinPosition: s.pitStopRejoinPosition,
      numSafetyCarPeriods: s.numSafetyCarPeriods,
      numVscPeriods: s.numVirtualSafetyCarPeriods,
      forecast,
    }
  }

  private playerSnapshot(): PlayerSnapshot | null {
    const i = this.playerIdx
    const t = this.telemetry?.[i]
    const st = this.status?.[i]
    if (!t || !st) return null
    const d = this.damage?.[i]
    const lap = this.lap?.[i]
    return {
      carIdx: i,
      speedKph: t.speed,
      gear: t.gear,
      throttle: t.throttle,
      brake: t.brake,
      steer: t.steer,
      rpm: t.engineRPM,
      drs: t.drs === 1,
      drsAllowed: st.drsAllowed === 1,
      tyreWear: d ? d.tyresWear : [0, 0, 0, 0],
      tyreSurfaceTemp: t.tyresSurfaceTemperature,
      tyreInnerTemp: t.tyresInnerTemperature,
      tyrePressure: t.tyresPressure,
      brakeTemp: t.brakesTemperature,
      fuelKg: st.fuelInTank,
      fuelMarginLaps: st.fuelRemainingLaps,
      fuelMix: st.fuelMix,
      brakeBias: st.frontBrakeBias,
      ersPercent: (st.ersStoreEnergy / 4_000_000) * 100,
      ersMode: st.ersDeployMode,
      damage: d
        ? {
            frontLeftWing: d.frontLeftWingDamage,
            frontRightWing: d.frontRightWingDamage,
            rearWing: d.rearWingDamage,
            floor: d.floorDamage,
            diffuser: d.diffuserDamage,
            sidepod: d.sidepodDamage,
            gearbox: d.gearBoxDamage,
            engine: d.engineDamage,
            drsFault: d.drsFault === 1,
            ersFault: d.ersFault === 1,
          }
        : null,
      setup: this.setups?.[i] ?? null,
      tyreSets: this.tyreSets,
      laps: [...this.playerLaps],
      bestLapMs: this.bestLapFor(i),
      lapInvalid: lap ? lap.currentLapInvalid === 1 : false,
    }
  }

  private bestLapFor(i: number): number {
    const h = this.history.get(i)
    // The game reports out-of-range values (seen: 199) when there is no valid lap yet.
    if (h && h.bestLapTimeLapNum > 0 && h.bestLapTimeLapNum <= h.numLaps) {
      const best = h.lapHistory[h.bestLapTimeLapNum - 1]?.lapTimeInMS ?? 0
      if (best > 0) return best
    }
    return this.cars[i]?.bestLapMs ?? 0
  }

  private carSnapshots(): CarSnapshot[] {
    const laps = this.lap
    if (!laps) return []
    const out: CarSnapshot[] = []
    for (let i = 0; i < laps.length; i++) {
      const l = laps[i]!
      if (l.carPosition === 0 || l.resultStatus < 2) continue
      const st = this.status?.[i]
      const who = this.names[i]
      const h = this.history.get(i)
      out.push({
        carIdx: i,
        name: who?.name ?? `Car ${i}`,
        raceNumber: who?.raceNumber ?? 0,
        teamId: who?.teamId ?? 255,
        aiControlled: who?.ai ?? true,
        isPlayer: i === this.playerIdx,
        position: l.carPosition,
        currentLap: l.currentLapNum,
        lastLapMs: l.lastLapTimeInMS,
        bestLapMs: this.bestLapFor(i),
        currentLapMs: l.currentLapTimeInMS,
        sector: l.sector,
        deltaToCarInFrontMs: l.deltaToCarInFrontInMS,
        deltaToLeaderMs: l.deltaToRaceLeaderInMS,
        pitStatus: l.pitStatus,
        numPitStops: l.numPitStops,
        penaltiesSec: l.penalties,
        driverStatus: l.driverStatus,
        resultStatus: l.resultStatus,
        tyreVisual: st ? (VISUAL_COMPOUNDS[st.visualTyreCompound] ?? null) : null,
        tyreActual: st ? (ACTUAL_COMPOUNDS[st.actualTyreCompound] ?? null) : null,
        tyreAgeLaps: st ? st.tyresAgeLaps : null,
        stints: h
          ? h.tyreStints.slice(0, h.numTyreStints).map((s) => ({
              compound: VISUAL_COMPOUNDS[s.tyreVisualCompound] ?? `#${s.tyreVisualCompound}`,
              endLap: s.endLap === 255 ? null : s.endLap,
            }))
          : [],
      })
    }
    return out.sort((a, b) => a.position - b.position)
  }
}
