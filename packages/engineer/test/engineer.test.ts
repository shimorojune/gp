import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CarSnapshot, CompletedLap, RaceSnapshot } from '@gp/telemetry'
import { describe, expect, it } from 'vitest'
import { NotesStore } from '../src/notes.ts'
import { buildSystemPrompt } from '../src/persona.ts'
import { isSilent } from '../src/radio.ts'
import { statusTag } from '../src/session.ts'
import { paceTargetsView, raceSnapshotView } from '../src/views.ts'

function car(over: Partial<CarSnapshot>): CarSnapshot {
  return {
    carIdx: 0,
    name: 'X',
    raceNumber: 1,
    teamId: 0,
    aiControlled: true,
    isPlayer: false,
    position: 1,
    currentLap: 5,
    lastLapMs: 74000,
    bestLapMs: 73500,
    currentLapMs: 0,
    lapDistanceM: 0,
    sector: 0,
    deltaToCarInFrontMs: 0,
    deltaToLeaderMs: 0,
    pitStatus: 0,
    numPitStops: 0,
    penaltiesSec: 0,
    servePenaltyAtNextStop: false,
    warnings: 0,
    unservedDriveThroughs: 0,
    unservedStopGos: 0,
    driverStatus: 1,
    resultStatus: 2,
    tyreVisual: 'Medium',
    tyreActual: 'C3',
    tyreAgeLaps: 4,
    stints: [],
    ...over,
  }
}

function lap(
  n: number,
  ms: number,
  s1: number,
  s2: number,
  gapAheadMs: number,
  over: Partial<CompletedLap> = {},
): CompletedLap {
  return {
    carIdx: 1,
    lapNumber: n,
    lapTimeMs: ms,
    sector1Ms: s1,
    sector2Ms: s2,
    sector3Ms: ms - s1 - s2,
    valid: true,
    tyreVisual: 'Soft',
    tyreAgeLaps: n,
    fuelKg: 50,
    position: 7,
    gapAheadMs,
    sessionTime: n * 74,
    ...over,
  }
}

function snapshot(): RaceSnapshot {
  const laps = [
    lap(1, 75000, 25000, 26000, 3000),
    lap(2, 74200, 24800, 25600, 2600),
    lap(3, 74500, 24600, 25900, 2200, { valid: false }),
    lap(4, 74100, 24900, 25500, 1800),
  ]
  return {
    status: 'live',
    sessionTime: 300,
    session: {
      track: 'Brazil',
      sessionType: 'Race',
      totalLaps: 18,
      safetyCar: 'None',
      weather: 'Clear',
      pitWindowIdealLap: 0,
    } as RaceSnapshot['session'],
    player: {
      laps,
      bestLapMs: 74100,
      tyreWear: [10, 11, 8, 9],
      fuelKg: 40,
      fuelMarginLaps: 1.44,
      ersPercent: 55,
      lapInvalid: false,
    } as unknown as RaceSnapshot['player'],
    cars: [
      car({
        carIdx: 0,
        name: 'HAMILTON',
        position: 6,
        lastLapMs: 74600,
        tyreVisual: 'Medium',
        tyreAgeLaps: 10,
      }),
      car({
        carIdx: 1,
        name: 'ROHIT',
        isPlayer: true,
        position: 7,
        deltaToCarInFrontMs: 1800,
        lastLapMs: 74100,
      }),
      car({ carIdx: 2, name: 'NORRIS', position: 8, deltaToCarInFrontMs: 900, lastLapMs: 74000 }),
    ],
    packetsPerSecond: 60,
  }
}

describe('views', () => {
  it('statusTag summarises the situation', () => {
    expect(statusTag(snapshot())).toBe('[live · Brazil Race · lap 5/18 · P7]')
  })

  it('race snapshot reports gaps ahead and behind', () => {
    const v = raceSnapshotView(snapshot())
    expect(v.yourCar).toEqual({ seatName: 'ROHIT', team: 'Mercedes' })
    expect(v.gapAhead).toEqual({ driver: 'HAMILTON', gap: '+1.800' })
    expect(v.gapBehind).toEqual({ driver: 'NORRIS', gap: '+0.900' })
    expect(v.tyreWearPct).toEqual({ FL: 8, FR: 9, RL: 10, RR: 11 })
  })

  it('pace targets: ideal lap from valid best sectors, chase maths from gap trend', () => {
    const v = paceTargetsView(snapshot())
    expect(v.bestValidLap).toBe('1:14.100')
    // Best valid sectors: S1 24.800 (lap 2), S2 25.500 (lap 4), S3 min(24000, 23800, 23700) = 23.700
    expect(v.idealLapFromBestSectors).toBe('1:14.000')
    expect(v.lastLapVsBestSectors).toEqual({ s1: '+0.100', s2: '+0.000', s3: '+0.000' })
    // Gap 3000 -> 1800 over the last 4 laps in P7: -400ms per lap.
    expect(v.chase?.gapChangePerLap).toBe('-0.400')
    expect(v.chase?.lapsToCatchAtCurrentRate).toBe(5)
    expect(v.chase?.lapTimeToCatchIn5Laps).toBe('1:14.240')
    expect(v.defend?.driver).toBe('NORRIS')
  })
})

describe('NotesStore', () => {
  it('persists notes and filters track notes by track', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'gp-notes-')), 'notes.json')
    const a = new NotesStore(path)
    a.add({ category: 'radio', text: 'Hates being told to save fuel', source: 'driver' })
    const t = a.add({
      category: 'track',
      track: 'Brazil',
      text: 'Brakes late into T1',
      source: 'engineer',
    })
    const b = new NotesStore(path)
    expect(b.all()).toHaveLength(2)
    expect(b.relevant('brazil')).toHaveLength(2)
    expect(b.relevant('Monza')).toHaveLength(1)
    expect(b.relevant(null)).toHaveLength(1)
    expect(b.remove(t.id)).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toHaveLength(1)
  })
})

describe('persona', () => {
  it('includes notes and the silent token', () => {
    const p = buildSystemPrompt({
      driverName: 'Rohit',
      engineerName: 'GP',
      notes: [
        {
          id: 'abc',
          category: 'radio',
          track: null,
          text: 'Likes it blunt',
          source: 'driver',
          createdAt: '',
          updatedAt: '',
        },
      ],
    })
    expect(p).toContain('Likes it blunt (id abc)')
    expect(p).toContain('(silent)')
  })

  it('recognises silent replies', () => {
    expect(isSilent('(silent)')).toBe(true)
    expect(isSilent(' (Silent). ')).toBe(true)
    expect(isSilent('Good lap, mate.')).toBe(false)
  })
})

describe('retired cars', () => {
  it('are skipped when finding the car ahead and behind', () => {
    const s = snapshot()
    s.cars[0]!.resultStatus = 7 // HAMILTON retired, still listed P6
    s.cars.unshift(car({ carIdx: 5, name: 'RUSSELL', position: 5, lastLapMs: 74400 }))
    const v = raceSnapshotView(s)
    expect(v.gapAhead?.driver).toBe('RUSSELL')
    expect(paceTargetsView(s).chase?.driver).toBe('RUSSELL')
  })
})

describe('practice and qualifying', () => {
  const practice = (): RaceSnapshot => {
    const s = snapshot()
    s.session = { ...s.session!, sessionType: 'P1', trackLengthM: 5000 }
    // Timesheet: HAMILTON P6, ROHIT P7, NORRIS P8. On the road: NORRIS 300 m ahead (across
    // the line), HAMILTON in the garage, VERSTAPPEN 200 m behind on a flying lap.
    s.cars[0]!.driverStatus = 0
    s.cars[1]!.lapDistanceM = 4900
    s.cars[2]!.lapDistanceM = 200
    s.cars.push(
      car({ carIdx: 3, name: 'VERSTAPPEN', position: 1, lapDistanceM: 4700, driverStatus: 1 }),
    )
    return s
  }
  it('uses the cars on the road, not the timesheet', () => {
    const v = raceSnapshotView(practice()) as Record<string, unknown>
    expect(v.gapAhead).toBeNull()
    const t = v.trafficOnTrack as {
      ahead: { driver: string; metres: number }
      behind: { driver: string; theirLap: string }
    }
    expect(t.ahead.driver).toBe('NORRIS')
    expect(t.ahead.metres).toBe(300)
    expect(t.behind.driver).toBe('VERSTAPPEN')
    expect(t.behind.theirLap).toBe('Flying lap')
    expect(paceTargetsView(practice()).chase).toBeNull()
  })
  it('marks the position as the timesheet', () => {
    expect(statusTag(practice())).toBe('[live · Brazil P1 · lap 5/18 · P7 on times]')
  })
})
