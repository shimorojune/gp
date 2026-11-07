/** F1 23 UDP spec constants (packet format 2023). */

export const PACKET_FORMAT = 2023
export const NUM_CARS = 22
export const HEADER_SIZE = 29
export const DEFAULT_PORT = 20777

export enum PacketId {
  Motion = 0,
  Session = 1,
  LapData = 2,
  Event = 3,
  Participants = 4,
  CarSetups = 5,
  CarTelemetry = 6,
  CarStatus = 7,
  FinalClassification = 8,
  LobbyInfo = 9,
  CarDamage = 10,
  SessionHistory = 11,
  TyreSets = 12,
  MotionEx = 13,
}

/** Exact packet sizes in bytes for format 2023 (from the spec; confirmed on Rohit's Mac). */
export const PACKET_SIZES: Record<PacketId, number> = {
  [PacketId.Motion]: 1349,
  [PacketId.Session]: 644,
  [PacketId.LapData]: 1131,
  [PacketId.Event]: 45,
  [PacketId.Participants]: 1306,
  [PacketId.CarSetups]: 1107,
  [PacketId.CarTelemetry]: 1352,
  [PacketId.CarStatus]: 1239,
  [PacketId.FinalClassification]: 1020,
  [PacketId.LobbyInfo]: 1218,
  [PacketId.CarDamage]: 953,
  [PacketId.SessionHistory]: 1460,
  [PacketId.TyreSets]: 231,
  [PacketId.MotionEx]: 217,
}

export const TRACKS: Record<number, string> = {
  0: 'Melbourne',
  1: 'Paul Ricard',
  2: 'Shanghai',
  3: 'Sakhir',
  4: 'Catalunya',
  5: 'Monaco',
  6: 'Montreal',
  7: 'Silverstone',
  8: 'Hockenheim',
  9: 'Hungaroring',
  10: 'Spa',
  11: 'Monza',
  12: 'Singapore',
  13: 'Suzuka',
  14: 'Abu Dhabi',
  15: 'Texas',
  16: 'Brazil',
  17: 'Austria',
  18: 'Sochi',
  19: 'Mexico',
  20: 'Baku',
  21: 'Sakhir Short',
  22: 'Silverstone Short',
  23: 'Texas Short',
  24: 'Suzuka Short',
  25: 'Hanoi',
  26: 'Zandvoort',
  27: 'Imola',
  28: 'Portimao',
  29: 'Jeddah',
  30: 'Miami',
  31: 'Las Vegas',
  32: 'Losail',
}

export const SESSION_TYPES: Record<number, string> = {
  0: 'Unknown',
  1: 'P1',
  2: 'P2',
  3: 'P3',
  4: 'Short Practice',
  5: 'Q1',
  6: 'Q2',
  7: 'Q3',
  8: 'Short Qualifying',
  9: 'One-Shot Qualifying',
  10: 'Race',
  11: 'Race 2',
  12: 'Race 3',
  13: 'Time Trial',
}

export const WEATHER: Record<number, string> = {
  0: 'Clear',
  1: 'Light cloud',
  2: 'Overcast',
  3: 'Light rain',
  4: 'Heavy rain',
  5: 'Storm',
}

/** Actual compounds (C-numbers) as the game reports them. */
export const ACTUAL_COMPOUNDS: Record<number, string> = {
  16: 'C5',
  17: 'C4',
  18: 'C3',
  19: 'C2',
  20: 'C1',
  21: 'C0',
  7: 'Inter',
  8: 'Wet',
  9: 'Dry (classic)',
  10: 'Wet (classic)',
  11: 'Super soft (F2)',
  12: 'Soft (F2)',
  13: 'Medium (F2)',
  14: 'Hard (F2)',
  15: 'Wet (F2)',
}

/** Visual compounds (what the sidewall shows). */
export const VISUAL_COMPOUNDS: Record<number, string> = {
  16: 'Soft',
  17: 'Medium',
  18: 'Hard',
  7: 'Inter',
  8: 'Wet',
  15: 'Wet (F2)',
  19: 'Super soft (F2)',
  20: 'Soft (F2)',
  21: 'Medium (F2)',
  22: 'Hard (F2)',
}

export const SAFETY_CAR_STATUS: Record<number, string> = {
  0: 'None',
  1: 'Full safety car',
  2: 'Virtual safety car',
  3: 'Formation lap',
}

export const PIT_STATUS: Record<number, string> = { 0: 'None', 1: 'Pitting', 2: 'In pit area' }

export const DRIVER_STATUS: Record<number, string> = {
  0: 'In garage',
  1: 'Flying lap',
  2: 'In lap',
  3: 'Out lap',
  4: 'On track',
}

export const RESULT_STATUS: Record<number, string> = {
  0: 'Invalid',
  1: 'Inactive',
  2: 'Active',
  3: 'Finished',
  4: 'DNF',
  5: 'Disqualified',
  6: 'Not classified',
  7: 'Retired',
}

export const ERS_MODES: Record<number, string> = {
  0: 'None',
  1: 'Medium',
  2: 'Hotlap',
  3: 'Overtake',
}

export const FUEL_MIX: Record<number, string> = { 0: 'Lean', 1: 'Standard', 2: 'Rich', 3: 'Max' }

export const EVENT_CODES = {
  SessionStarted: 'SSTA',
  SessionEnded: 'SEND',
  FastestLap: 'FTLP',
  Retirement: 'RTMT',
  DrsEnabled: 'DRSE',
  DrsDisabled: 'DRSD',
  TeamMateInPits: 'TMPT',
  ChequeredFlag: 'CHQF',
  RaceWinner: 'RCWN',
  Penalty: 'PENA',
  SpeedTrap: 'SPTP',
  StartLights: 'STLG',
  LightsOut: 'LGOT',
  DriveThroughServed: 'DTSV',
  StopGoServed: 'SGSV',
  Flashback: 'FLBK',
  Buttons: 'BUTN',
  RedFlag: 'RDFL',
  Overtake: 'OVTK',
} as const

export type EventCode = (typeof EVENT_CODES)[keyof typeof EVENT_CODES]

/** F1 23 team ids (2023 grid). Others (F2, custom, My Team) fall back to "team N". */
export const TEAMS: Record<number, string> = {
  0: 'Mercedes',
  1: 'Ferrari',
  2: 'Red Bull Racing',
  3: 'Williams',
  4: 'Aston Martin',
  5: 'Alpine',
  6: 'AlphaTauri',
  7: 'Haas',
  8: 'McLaren',
  9: 'Alfa Romeo',
}

/** PENA event penaltyType (F1 23 spec). */
export const PENALTY_TYPES: Record<number, string> = {
  0: 'drive through',
  1: 'stop go',
  2: 'grid penalty',
  3: 'penalty reminder',
  4: 'time penalty',
  5: 'warning',
  6: 'disqualified',
  7: 'removed from formation lap',
  8: 'parked too long timer',
  9: 'tyre regulations',
  10: 'this lap invalidated',
  11: 'this and next lap invalidated',
  12: 'this lap invalidated without reason',
  13: 'this and next lap invalidated without reason',
  14: 'this and previous lap invalidated',
  15: 'this and previous lap invalidated without reason',
  16: 'retired',
  17: 'black flag timer',
}

/** PENA event infringementType (F1 23 spec). */
export const INFRINGEMENT_TYPES: Record<number, string> = {
  0: 'blocking by slow driving',
  1: 'blocking by wrong way driving',
  2: 'reversing off the start line',
  3: 'big collision',
  4: 'small collision',
  5: 'collision, failed to hand back position',
  6: 'collision, failed to hand back positions',
  7: 'corner cutting gained time',
  8: 'corner cutting overtake',
  9: 'corner cutting overtakes',
  10: 'crossed pit exit lane',
  11: 'ignoring blue flags',
  12: 'ignoring yellow flags',
  13: 'ignoring drive through',
  14: 'too many drive throughs',
  15: 'drive through reminder, serve within n laps',
  16: 'drive through reminder, serve this lap',
  17: 'pit lane speeding',
  18: 'parked for too long',
  19: 'ignoring tyre regulations',
  20: 'too many penalties',
  21: 'multiple warnings',
  22: 'approaching disqualification',
  23: 'tyre regulations, select single',
  24: 'tyre regulations, select multiple',
  25: 'lap invalidated, corner cutting',
  26: 'lap invalidated, running wide',
  27: 'corner cutting, ran wide, gained time (minor)',
  28: 'corner cutting, ran wide, gained time (significant)',
  29: 'corner cutting, ran wide, gained time (extreme)',
  30: 'lap invalidated, wall riding',
  31: 'lap invalidated, flashback used',
  32: 'lap invalidated, reset to track',
  33: 'blocking the pit lane',
  34: 'jump start',
  35: 'safety car to car collision',
  36: 'safety car illegal overtake',
  37: 'safety car exceeding allowed pace',
  38: 'virtual safety car exceeding allowed pace',
  39: 'formation lap below allowed speed',
  40: 'formation lap parking',
  41: 'retired, mechanical failure',
  42: 'retired, terminally damaged',
  43: 'safety car falling too far back',
  44: 'black flag timer',
  45: 'unserved stop go penalty',
  46: 'unserved drive through penalty',
  47: 'engine component change',
  48: 'gearbox change',
  49: 'parc ferme change',
  50: 'league grid penalty',
  51: 'retry penalty',
  52: 'illegal time gain',
  53: 'mandatory pitstop',
  54: 'attribute assigned',
}

/** F1 23 game modes (Session packet `gameMode`). */
export const GAME_MODES: Record<number, string> = {
  0: 'Event Mode',
  3: 'Grand Prix',
  4: "Grand Prix '23",
  5: 'Time Trial',
  6: 'Splitscreen',
  7: 'Online Custom',
  8: 'Online League',
  11: 'Career Invitational',
  12: 'Championship Invitational',
  13: 'Championship',
  14: 'Online Championship',
  15: 'Online Weekly Event',
  17: 'Story Mode',
  19: "Career '22",
  20: "Career '22 Online",
  21: "Career '23",
  22: "Career '23 Online",
  127: 'Benchmark',
}

/** Career seasons count as the real thing; everything else is simulator time. */
export const CAREER_GAME_MODES: ReadonlySet<number> = new Set([19, 20, 21, 22])
