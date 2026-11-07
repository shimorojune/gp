/**
 * F1 23 (packet format 2023) packet structs and readers.
 * Field names follow the official spec minus the `m_` prefix.
 * Wheel arrays are in the game's order: RL, RR, FL, FR.
 */
import { NUM_CARS } from './constants.ts'
import { type Reader, type Wheels, f32, u8, u16 } from './reader.ts'

// ---------------------------------------------------------------- 0 Motion

export interface CarMotion {
  worldPositionX: number
  worldPositionY: number
  worldPositionZ: number
  worldVelocityX: number
  worldVelocityY: number
  worldVelocityZ: number
  /** Normalised int16 (divide by 32767 for a unit vector). */
  worldForwardDirX: number
  worldForwardDirY: number
  worldForwardDirZ: number
  worldRightDirX: number
  worldRightDirY: number
  worldRightDirZ: number
  gForceLateral: number
  gForceLongitudinal: number
  gForceVertical: number
  yaw: number
  pitch: number
  roll: number
}

export interface MotionData {
  cars: CarMotion[]
}

function readCarMotion(r: Reader): CarMotion {
  return {
    worldPositionX: r.f32(),
    worldPositionY: r.f32(),
    worldPositionZ: r.f32(),
    worldVelocityX: r.f32(),
    worldVelocityY: r.f32(),
    worldVelocityZ: r.f32(),
    worldForwardDirX: r.i16(),
    worldForwardDirY: r.i16(),
    worldForwardDirZ: r.i16(),
    worldRightDirX: r.i16(),
    worldRightDirY: r.i16(),
    worldRightDirZ: r.i16(),
    gForceLateral: r.f32(),
    gForceLongitudinal: r.f32(),
    gForceVertical: r.f32(),
    yaw: r.f32(),
    pitch: r.f32(),
    roll: r.f32(),
  }
}

export function readMotion(r: Reader): MotionData {
  return { cars: r.array(NUM_CARS, readCarMotion) }
}

// ---------------------------------------------------------------- 1 Session

export interface MarshalZone {
  zoneStart: number
  /** -1 invalid/unknown, 0 none, 1 green, 2 blue, 3 yellow */
  zoneFlag: number
}

export interface WeatherForecastSample {
  sessionType: number
  /** Minutes from now. */
  timeOffset: number
  weather: number
  trackTemperature: number
  /** 0 up, 1 down, 2 no change */
  trackTemperatureChange: number
  airTemperature: number
  airTemperatureChange: number
  rainPercentage: number
}

export interface SessionData {
  weather: number
  trackTemperature: number
  airTemperature: number
  totalLaps: number
  trackLength: number
  sessionType: number
  trackId: number
  formula: number
  sessionTimeLeft: number
  sessionDuration: number
  pitSpeedLimit: number
  gamePaused: number
  isSpectating: number
  spectatorCarIndex: number
  sliProNativeSupport: number
  numMarshalZones: number
  marshalZones: MarshalZone[]
  safetyCarStatus: number
  networkGame: number
  numWeatherForecastSamples: number
  /** Only the first `numWeatherForecastSamples` entries are meaningful. */
  weatherForecastSamples: WeatherForecastSample[]
  /** 0 perfect, 1 approximate */
  forecastAccuracy: number
  aiDifficulty: number
  seasonLinkIdentifier: number
  weekendLinkIdentifier: number
  sessionLinkIdentifier: number
  pitStopWindowIdealLap: number
  pitStopWindowLatestLap: number
  pitStopRejoinPosition: number
  steeringAssist: number
  brakingAssist: number
  gearboxAssist: number
  pitAssist: number
  pitReleaseAssist: number
  ersAssist: number
  drsAssist: number
  dynamicRacingLine: number
  dynamicRacingLineType: number
  gameMode: number
  ruleSet: number
  timeOfDay: number
  sessionLength: number
  speedUnitsLeadPlayer: number
  temperatureUnitsLeadPlayer: number
  speedUnitsSecondaryPlayer: number
  temperatureUnitsSecondaryPlayer: number
  numSafetyCarPeriods: number
  numVirtualSafetyCarPeriods: number
  numRedFlagPeriods: number
}

function readWeatherSample(r: Reader): WeatherForecastSample {
  return {
    sessionType: r.u8(),
    timeOffset: r.u8(),
    weather: r.u8(),
    trackTemperature: r.i8(),
    trackTemperatureChange: r.i8(),
    airTemperature: r.i8(),
    airTemperatureChange: r.i8(),
    rainPercentage: r.u8(),
  }
}

export function readSession(r: Reader): SessionData {
  return {
    weather: r.u8(),
    trackTemperature: r.i8(),
    airTemperature: r.i8(),
    totalLaps: r.u8(),
    trackLength: r.u16(),
    sessionType: r.u8(),
    trackId: r.i8(),
    formula: r.u8(),
    sessionTimeLeft: r.u16(),
    sessionDuration: r.u16(),
    pitSpeedLimit: r.u8(),
    gamePaused: r.u8(),
    isSpectating: r.u8(),
    spectatorCarIndex: r.u8(),
    sliProNativeSupport: r.u8(),
    numMarshalZones: r.u8(),
    marshalZones: r.array(21, (x) => ({ zoneStart: x.f32(), zoneFlag: x.i8() })),
    safetyCarStatus: r.u8(),
    networkGame: r.u8(),
    numWeatherForecastSamples: r.u8(),
    weatherForecastSamples: r.array(56, readWeatherSample),
    forecastAccuracy: r.u8(),
    aiDifficulty: r.u8(),
    seasonLinkIdentifier: r.u32(),
    weekendLinkIdentifier: r.u32(),
    sessionLinkIdentifier: r.u32(),
    pitStopWindowIdealLap: r.u8(),
    pitStopWindowLatestLap: r.u8(),
    pitStopRejoinPosition: r.u8(),
    steeringAssist: r.u8(),
    brakingAssist: r.u8(),
    gearboxAssist: r.u8(),
    pitAssist: r.u8(),
    pitReleaseAssist: r.u8(),
    ersAssist: r.u8(),
    drsAssist: r.u8(),
    dynamicRacingLine: r.u8(),
    dynamicRacingLineType: r.u8(),
    gameMode: r.u8(),
    ruleSet: r.u8(),
    timeOfDay: r.u32(),
    sessionLength: r.u8(),
    speedUnitsLeadPlayer: r.u8(),
    temperatureUnitsLeadPlayer: r.u8(),
    speedUnitsSecondaryPlayer: r.u8(),
    temperatureUnitsSecondaryPlayer: r.u8(),
    numSafetyCarPeriods: r.u8(),
    numVirtualSafetyCarPeriods: r.u8(),
    numRedFlagPeriods: r.u8(),
  }
}

// ---------------------------------------------------------------- 2 Lap data

export interface LapData {
  lastLapTimeInMS: number
  currentLapTimeInMS: number
  sector1TimeInMS: number
  sector1TimeMinutes: number
  sector2TimeInMS: number
  sector2TimeMinutes: number
  deltaToCarInFrontInMS: number
  deltaToRaceLeaderInMS: number
  lapDistance: number
  totalDistance: number
  safetyCarDelta: number
  carPosition: number
  currentLapNum: number
  pitStatus: number
  numPitStops: number
  /** 0 = sector 1, 1 = sector 2, 2 = sector 3 */
  sector: number
  currentLapInvalid: number
  penalties: number
  totalWarnings: number
  cornerCuttingWarnings: number
  numUnservedDriveThroughPens: number
  numUnservedStopGoPens: number
  gridPosition: number
  driverStatus: number
  resultStatus: number
  pitLaneTimerActive: number
  pitLaneTimeInLaneInMS: number
  pitStopTimerInMS: number
  pitStopShouldServePen: number
}

export interface LapDataPacket {
  cars: LapData[]
  timeTrialPBCarIdx: number
  timeTrialRivalCarIdx: number
}

function readLapData(r: Reader): LapData {
  return {
    lastLapTimeInMS: r.u32(),
    currentLapTimeInMS: r.u32(),
    sector1TimeInMS: r.u16(),
    sector1TimeMinutes: r.u8(),
    sector2TimeInMS: r.u16(),
    sector2TimeMinutes: r.u8(),
    deltaToCarInFrontInMS: r.u16(),
    deltaToRaceLeaderInMS: r.u16(),
    lapDistance: r.f32(),
    totalDistance: r.f32(),
    safetyCarDelta: r.f32(),
    carPosition: r.u8(),
    currentLapNum: r.u8(),
    pitStatus: r.u8(),
    numPitStops: r.u8(),
    sector: r.u8(),
    currentLapInvalid: r.u8(),
    penalties: r.u8(),
    totalWarnings: r.u8(),
    cornerCuttingWarnings: r.u8(),
    numUnservedDriveThroughPens: r.u8(),
    numUnservedStopGoPens: r.u8(),
    gridPosition: r.u8(),
    driverStatus: r.u8(),
    resultStatus: r.u8(),
    pitLaneTimerActive: r.u8(),
    pitLaneTimeInLaneInMS: r.u16(),
    pitStopTimerInMS: r.u16(),
    pitStopShouldServePen: r.u8(),
  }
}

export function readLapDataPacket(r: Reader): LapDataPacket {
  return {
    cars: r.array(NUM_CARS, readLapData),
    timeTrialPBCarIdx: r.u8(),
    timeTrialRivalCarIdx: r.u8(),
  }
}

// ---------------------------------------------------------------- 3 Event

export type EventDetails =
  | { code: 'FTLP'; vehicleIdx: number; lapTime: number }
  | { code: 'RTMT' | 'TMPT' | 'RCWN' | 'DTSV' | 'SGSV'; vehicleIdx: number }
  | {
      code: 'PENA'
      penaltyType: number
      infringementType: number
      vehicleIdx: number
      otherVehicleIdx: number
      time: number
      lapNum: number
      placesGained: number
    }
  | {
      code: 'SPTP'
      vehicleIdx: number
      speed: number
      isOverallFastestInSession: number
      isDriverFastestInSession: number
      fastestVehicleIdxInSession: number
      fastestSpeedInSession: number
    }
  | { code: 'STLG'; numLights: number }
  | { code: 'FLBK'; flashbackFrameIdentifier: number; flashbackSessionTime: number }
  | { code: 'BUTN'; buttonStatus: number }
  | { code: 'OVTK'; overtakingVehicleIdx: number; beingOvertakenVehicleIdx: number }
  | { code: 'SSTA' | 'SEND' | 'DRSE' | 'DRSD' | 'CHQF' | 'LGOT' | 'RDFL' }
  | { code: string; unknown: true }

export interface EventData {
  code: string
  details: EventDetails
}

export function readEvent(r: Reader): EventData {
  const code = r.str(4)
  const details = readEventDetails(code, r)
  // The details union is always 12 bytes on the wire; consumers don't care about the tail.
  return { code, details }
}

function readEventDetails(code: string, r: Reader): EventDetails {
  switch (code) {
    case 'FTLP':
      return { code, vehicleIdx: r.u8(), lapTime: r.f32() }
    case 'RTMT':
    case 'TMPT':
    case 'RCWN':
    case 'DTSV':
    case 'SGSV':
      return { code, vehicleIdx: r.u8() }
    case 'PENA':
      return {
        code,
        penaltyType: r.u8(),
        infringementType: r.u8(),
        vehicleIdx: r.u8(),
        otherVehicleIdx: r.u8(),
        time: r.u8(),
        lapNum: r.u8(),
        placesGained: r.u8(),
      }
    case 'SPTP':
      return {
        code,
        vehicleIdx: r.u8(),
        speed: r.f32(),
        isOverallFastestInSession: r.u8(),
        isDriverFastestInSession: r.u8(),
        fastestVehicleIdxInSession: r.u8(),
        fastestSpeedInSession: r.f32(),
      }
    case 'STLG':
      return { code, numLights: r.u8() }
    case 'FLBK':
      return { code, flashbackFrameIdentifier: r.u32(), flashbackSessionTime: r.f32() }
    case 'BUTN':
      return { code, buttonStatus: r.u32() }
    case 'OVTK':
      return { code, overtakingVehicleIdx: r.u8(), beingOvertakenVehicleIdx: r.u8() }
    case 'SSTA':
    case 'SEND':
    case 'DRSE':
    case 'DRSD':
    case 'CHQF':
    case 'LGOT':
    case 'RDFL':
      return { code }
    default:
      return { code, unknown: true }
  }
}

// ---------------------------------------------------------------- 4 Participants

export interface Participant {
  aiControlled: number
  driverId: number
  networkId: number
  teamId: number
  myTeam: number
  raceNumber: number
  nationality: number
  name: string
  /** 0 restricted, 1 public */
  yourTelemetry: number
  showOnlineNames: number
  platform: number
}

export interface ParticipantsData {
  numActiveCars: number
  participants: Participant[]
}

function readParticipant(r: Reader): Participant {
  return {
    aiControlled: r.u8(),
    driverId: r.u8(),
    networkId: r.u8(),
    teamId: r.u8(),
    myTeam: r.u8(),
    raceNumber: r.u8(),
    nationality: r.u8(),
    name: r.str(48),
    yourTelemetry: r.u8(),
    showOnlineNames: r.u8(),
    platform: r.u8(),
  }
}

export function readParticipants(r: Reader): ParticipantsData {
  return { numActiveCars: r.u8(), participants: r.array(NUM_CARS, readParticipant) }
}

// ---------------------------------------------------------------- 5 Car setups

export interface CarSetup {
  frontWing: number
  rearWing: number
  onThrottle: number
  offThrottle: number
  frontCamber: number
  rearCamber: number
  frontToe: number
  rearToe: number
  frontSuspension: number
  rearSuspension: number
  frontAntiRollBar: number
  rearAntiRollBar: number
  frontSuspensionHeight: number
  rearSuspensionHeight: number
  brakePressure: number
  brakeBias: number
  rearLeftTyrePressure: number
  rearRightTyrePressure: number
  frontLeftTyrePressure: number
  frontRightTyrePressure: number
  ballast: number
  fuelLoad: number
}

export interface CarSetupsData {
  cars: CarSetup[]
}

function readCarSetup(r: Reader): CarSetup {
  return {
    frontWing: r.u8(),
    rearWing: r.u8(),
    onThrottle: r.u8(),
    offThrottle: r.u8(),
    frontCamber: r.f32(),
    rearCamber: r.f32(),
    frontToe: r.f32(),
    rearToe: r.f32(),
    frontSuspension: r.u8(),
    rearSuspension: r.u8(),
    frontAntiRollBar: r.u8(),
    rearAntiRollBar: r.u8(),
    frontSuspensionHeight: r.u8(),
    rearSuspensionHeight: r.u8(),
    brakePressure: r.u8(),
    brakeBias: r.u8(),
    rearLeftTyrePressure: r.f32(),
    rearRightTyrePressure: r.f32(),
    frontLeftTyrePressure: r.f32(),
    frontRightTyrePressure: r.f32(),
    ballast: r.u8(),
    fuelLoad: r.f32(),
  }
}

export function readCarSetups(r: Reader): CarSetupsData {
  return { cars: r.array(NUM_CARS, readCarSetup) }
}

// ---------------------------------------------------------------- 6 Car telemetry

export interface CarTelemetry {
  /** km/h */
  speed: number
  /** 0..1 */
  throttle: number
  /** -1 (full left) .. 1 (full right) */
  steer: number
  /** 0..1 */
  brake: number
  clutch: number
  /** -1 reverse, 0 neutral, 1-8 */
  gear: number
  engineRPM: number
  drs: number
  revLightsPercent: number
  revLightsBitValue: number
  brakesTemperature: Wheels<number>
  tyresSurfaceTemperature: Wheels<number>
  tyresInnerTemperature: Wheels<number>
  engineTemperature: number
  /** PSI */
  tyresPressure: Wheels<number>
  surfaceType: Wheels<number>
}

export interface CarTelemetryData {
  cars: CarTelemetry[]
  mfdPanelIndex: number
  mfdPanelIndexSecondaryPlayer: number
  /** 0 when no suggestion */
  suggestedGear: number
}

function readCarTelemetry(r: Reader): CarTelemetry {
  return {
    speed: r.u16(),
    throttle: r.f32(),
    steer: r.f32(),
    brake: r.f32(),
    clutch: r.u8(),
    gear: r.i8(),
    engineRPM: r.u16(),
    drs: r.u8(),
    revLightsPercent: r.u8(),
    revLightsBitValue: r.u16(),
    brakesTemperature: r.wheels(u16),
    tyresSurfaceTemperature: r.wheels(u8),
    tyresInnerTemperature: r.wheels(u8),
    engineTemperature: r.u16(),
    tyresPressure: r.wheels(f32),
    surfaceType: r.wheels(u8),
  }
}

export function readCarTelemetryPacket(r: Reader): CarTelemetryData {
  return {
    cars: r.array(NUM_CARS, readCarTelemetry),
    mfdPanelIndex: r.u8(),
    mfdPanelIndexSecondaryPlayer: r.u8(),
    suggestedGear: r.i8(),
  }
}

// ---------------------------------------------------------------- 7 Car status

export interface CarStatus {
  tractionControl: number
  antiLockBrakes: number
  fuelMix: number
  frontBrakeBias: number
  pitLimiterStatus: number
  /** kg */
  fuelInTank: number
  fuelCapacity: number
  /** Laps of fuel left relative to what the game expects you to need (can be negative). */
  fuelRemainingLaps: number
  maxRPM: number
  idleRPM: number
  maxGears: number
  drsAllowed: number
  drsActivationDistance: number
  actualTyreCompound: number
  visualTyreCompound: number
  tyresAgeLaps: number
  vehicleFiaFlags: number
  enginePowerICE: number
  enginePowerMGUK: number
  /** Joules, max 4 MJ */
  ersStoreEnergy: number
  ersDeployMode: number
  ersHarvestedThisLapMGUK: number
  ersHarvestedThisLapMGUH: number
  ersDeployedThisLap: number
  networkPaused: number
}

export interface CarStatusData {
  cars: CarStatus[]
}

function readCarStatus(r: Reader): CarStatus {
  return {
    tractionControl: r.u8(),
    antiLockBrakes: r.u8(),
    fuelMix: r.u8(),
    frontBrakeBias: r.u8(),
    pitLimiterStatus: r.u8(),
    fuelInTank: r.f32(),
    fuelCapacity: r.f32(),
    fuelRemainingLaps: r.f32(),
    maxRPM: r.u16(),
    idleRPM: r.u16(),
    maxGears: r.u8(),
    drsAllowed: r.u8(),
    drsActivationDistance: r.u16(),
    actualTyreCompound: r.u8(),
    visualTyreCompound: r.u8(),
    tyresAgeLaps: r.u8(),
    vehicleFiaFlags: r.i8(),
    enginePowerICE: r.f32(),
    enginePowerMGUK: r.f32(),
    ersStoreEnergy: r.f32(),
    ersDeployMode: r.u8(),
    ersHarvestedThisLapMGUK: r.f32(),
    ersHarvestedThisLapMGUH: r.f32(),
    ersDeployedThisLap: r.f32(),
    networkPaused: r.u8(),
  }
}

export function readCarStatusPacket(r: Reader): CarStatusData {
  return { cars: r.array(NUM_CARS, readCarStatus) }
}

// ---------------------------------------------------------------- 8 Final classification

export interface FinalClassification {
  position: number
  numLaps: number
  gridPosition: number
  points: number
  numPitStops: number
  resultStatus: number
  bestLapTimeInMS: number
  /** seconds, without penalties */
  totalRaceTime: number
  penaltiesTime: number
  numPenalties: number
  numTyreStints: number
  tyreStintsActual: number[]
  tyreStintsVisual: number[]
  tyreStintsEndLaps: number[]
}

export interface FinalClassificationData {
  numCars: number
  cars: FinalClassification[]
}

function readFinalClassification(r: Reader): FinalClassification {
  return {
    position: r.u8(),
    numLaps: r.u8(),
    gridPosition: r.u8(),
    points: r.u8(),
    numPitStops: r.u8(),
    resultStatus: r.u8(),
    bestLapTimeInMS: r.u32(),
    totalRaceTime: r.f64(),
    penaltiesTime: r.u8(),
    numPenalties: r.u8(),
    numTyreStints: r.u8(),
    tyreStintsActual: r.array(8, u8),
    tyreStintsVisual: r.array(8, u8),
    tyreStintsEndLaps: r.array(8, u8),
  }
}

export function readFinalClassificationPacket(r: Reader): FinalClassificationData {
  return { numCars: r.u8(), cars: r.array(NUM_CARS, readFinalClassification) }
}

// ---------------------------------------------------------------- 10 Car damage

export interface CarDamage {
  /** Percent, 0-100 */
  tyresWear: Wheels<number>
  tyresDamage: Wheels<number>
  brakesDamage: Wheels<number>
  frontLeftWingDamage: number
  frontRightWingDamage: number
  rearWingDamage: number
  floorDamage: number
  diffuserDamage: number
  sidepodDamage: number
  drsFault: number
  ersFault: number
  gearBoxDamage: number
  engineDamage: number
  engineMGUHWear: number
  engineESWear: number
  engineCEWear: number
  engineICEWear: number
  engineMGUKWear: number
  engineTCWear: number
  engineBlown: number
  engineSeized: number
}

export interface CarDamageData {
  cars: CarDamage[]
}

function readCarDamage(r: Reader): CarDamage {
  return {
    tyresWear: r.wheels(f32),
    tyresDamage: r.wheels(u8),
    brakesDamage: r.wheels(u8),
    frontLeftWingDamage: r.u8(),
    frontRightWingDamage: r.u8(),
    rearWingDamage: r.u8(),
    floorDamage: r.u8(),
    diffuserDamage: r.u8(),
    sidepodDamage: r.u8(),
    drsFault: r.u8(),
    ersFault: r.u8(),
    gearBoxDamage: r.u8(),
    engineDamage: r.u8(),
    engineMGUHWear: r.u8(),
    engineESWear: r.u8(),
    engineCEWear: r.u8(),
    engineICEWear: r.u8(),
    engineMGUKWear: r.u8(),
    engineTCWear: r.u8(),
    engineBlown: r.u8(),
    engineSeized: r.u8(),
  }
}

export function readCarDamagePacket(r: Reader): CarDamageData {
  return { cars: r.array(NUM_CARS, readCarDamage) }
}

// ---------------------------------------------------------------- 11 Session history

export interface LapHistory {
  lapTimeInMS: number
  sector1TimeInMS: number
  sector1TimeMinutes: number
  sector2TimeInMS: number
  sector2TimeMinutes: number
  sector3TimeInMS: number
  sector3TimeMinutes: number
  /** bit0 lap valid, bit1 s1 valid, bit2 s2 valid, bit3 s3 valid */
  lapValidBitFlags: number
}

export interface TyreStintHistory {
  /** 255 = current tyre */
  endLap: number
  tyreActualCompound: number
  tyreVisualCompound: number
}

export interface SessionHistoryData {
  carIdx: number
  numLaps: number
  numTyreStints: number
  bestLapTimeLapNum: number
  bestSector1LapNum: number
  bestSector2LapNum: number
  bestSector3LapNum: number
  /** Only the first `numLaps` entries are meaningful. */
  lapHistory: LapHistory[]
  /** Only the first `numTyreStints` entries are meaningful. */
  tyreStints: TyreStintHistory[]
}

export function readSessionHistory(r: Reader): SessionHistoryData {
  return {
    carIdx: r.u8(),
    numLaps: r.u8(),
    numTyreStints: r.u8(),
    bestLapTimeLapNum: r.u8(),
    bestSector1LapNum: r.u8(),
    bestSector2LapNum: r.u8(),
    bestSector3LapNum: r.u8(),
    lapHistory: r.array(100, (x) => ({
      lapTimeInMS: x.u32(),
      sector1TimeInMS: x.u16(),
      sector1TimeMinutes: x.u8(),
      sector2TimeInMS: x.u16(),
      sector2TimeMinutes: x.u8(),
      sector3TimeInMS: x.u16(),
      sector3TimeMinutes: x.u8(),
      lapValidBitFlags: x.u8(),
    })),
    tyreStints: r.array(8, (x) => ({
      endLap: x.u8(),
      tyreActualCompound: x.u8(),
      tyreVisualCompound: x.u8(),
    })),
  }
}

// ---------------------------------------------------------------- 12 Tyre sets

export interface TyreSet {
  actualTyreCompound: number
  visualTyreCompound: number
  /** Percent */
  wear: number
  available: number
  recommendedSession: number
  lifeSpan: number
  usableLife: number
  /** ms delta vs the fitted set */
  lapDeltaTime: number
  fitted: number
}

export interface TyreSetsData {
  carIdx: number
  /** 13 dry + 7 wet */
  sets: TyreSet[]
  fittedIdx: number
}

export function readTyreSets(r: Reader): TyreSetsData {
  return {
    carIdx: r.u8(),
    sets: r.array(20, (x) => ({
      actualTyreCompound: x.u8(),
      visualTyreCompound: x.u8(),
      wear: x.u8(),
      available: x.u8(),
      recommendedSession: x.u8(),
      lifeSpan: x.u8(),
      usableLife: x.u8(),
      lapDeltaTime: x.i16(),
      fitted: x.u8(),
    })),
    fittedIdx: r.u8(),
  }
}

// ---------------------------------------------------------------- 13 Motion ex (player only)

export interface MotionExData {
  suspensionPosition: Wheels<number>
  suspensionVelocity: Wheels<number>
  suspensionAcceleration: Wheels<number>
  wheelSpeed: Wheels<number>
  wheelSlipRatio: Wheels<number>
  wheelSlipAngle: Wheels<number>
  wheelLatForce: Wheels<number>
  wheelLongForce: Wheels<number>
  heightOfCOGAboveGround: number
  localVelocityX: number
  localVelocityY: number
  localVelocityZ: number
  angularVelocityX: number
  angularVelocityY: number
  angularVelocityZ: number
  angularAccelerationX: number
  angularAccelerationY: number
  angularAccelerationZ: number
  /** radians */
  frontWheelsAngle: number
  wheelVertForce: Wheels<number>
}

export function readMotionEx(r: Reader): MotionExData {
  return {
    suspensionPosition: r.wheels(f32),
    suspensionVelocity: r.wheels(f32),
    suspensionAcceleration: r.wheels(f32),
    wheelSpeed: r.wheels(f32),
    wheelSlipRatio: r.wheels(f32),
    wheelSlipAngle: r.wheels(f32),
    wheelLatForce: r.wheels(f32),
    wheelLongForce: r.wheels(f32),
    heightOfCOGAboveGround: r.f32(),
    localVelocityX: r.f32(),
    localVelocityY: r.f32(),
    localVelocityZ: r.f32(),
    angularVelocityX: r.f32(),
    angularVelocityY: r.f32(),
    angularVelocityZ: r.f32(),
    angularAccelerationX: r.f32(),
    angularAccelerationY: r.f32(),
    angularAccelerationZ: r.f32(),
    frontWheelsAngle: r.f32(),
    wheelVertForce: r.wheels(f32),
  }
}
