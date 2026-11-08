import type { HistoryDb } from './db.ts'
import { seasonTeamPace } from './team.ts'

const QUALI = ['Q1', 'Q2', 'Q3', 'Short Qualifying', 'One-Shot Qualifying']
const RACE = ['Race', 'Race 2', 'Race 3']

interface WeekendRow {
  weekend_link: number
  track: string
  started: string
  team: string | null
  teammate: string | null
}

export interface CareerRound {
  round: number
  date: string
  track: string
  quali: number | null
  teammateQuali: number | null
  race: number | null
  grid: number | null
  teammateRace: number | null
  points: number | null
  teammatePoints: number | null
}

/**
 * The career season so far, from career-mode sessions only. Rounds are race weekends (the
 * game's weekend link). Standings only count the races the app saw.
 */
export function careerView(db: HistoryDb, seasonLink?: number) {
  const season =
    seasonLink ??
    (
      db.db
        .prepare(
          "SELECT season_link FROM sessions WHERE program = 'career' ORDER BY started_at DESC LIMIT 1",
        )
        .get() as { season_link: number } | undefined
    )?.season_link
  if (season === undefined) return null
  const weekends = db.db
    .prepare(
      `SELECT weekend_link, MAX(track) AS track, MIN(started_at) AS started, MAX(team) AS team,
         MAX(teammate) AS teammate
       FROM sessions WHERE program = 'career' AND season_link = ?
       GROUP BY weekend_link ORDER BY started`,
    )
    .all(season) as unknown as WeekendRow[]
  const last = (types: string[], weekend: number) =>
    db.db
      .prepare(
        `SELECT finish_pos, grid_pos, points, teammate_pos, teammate_points FROM sessions
         WHERE program = 'career' AND weekend_link = ? AND session_type IN (${types.map(() => '?').join(', ')})
           AND finish_pos IS NOT NULL
         ORDER BY started_at DESC LIMIT 1`,
      )
      .get(weekend, ...types) as
      | {
          finish_pos: number
          grid_pos: number
          points: number
          teammate_pos: number | null
          teammate_points: number | null
        }
      | undefined
  const rounds: CareerRound[] = weekends.map((w, i) => {
    const q = last(QUALI, w.weekend_link)
    const r = last(RACE, w.weekend_link)
    return {
      round: i + 1,
      date: w.started.slice(0, 10),
      track: w.track,
      quali: q?.finish_pos ?? null,
      teammateQuali: q?.teammate_pos ?? null,
      race: r?.finish_pos ?? null,
      grid: r?.grid_pos ?? null,
      teammateRace: r?.teammate_pos ?? null,
      points: r?.points ?? null,
      teammatePoints: r?.teammate_points ?? null,
    }
  })
  const h2h = (a: (r: CareerRound) => number | null, b: (r: CareerRound) => number | null) => {
    let me = 0
    let him = 0
    for (const r of rounds) {
      const x = a(r)
      const y = b(r)
      if (x === null || y === null) continue
      if (x < y) me++
      else him++
    }
    return `${me}-${him}`
  }
  const races = rounds.filter((r) => r.race !== null)
  const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0)
  // Championship from the classifications we stored (every driver's points per race).
  const standings = db.db
    .prepare(
      `SELECT c.name, MAX(c.team) AS team, SUM(c.points) AS points, MAX(c.is_player) AS me
       FROM classification c JOIN sessions s ON s.id = c.session_id
       WHERE s.program = 'career' AND s.season_link = ? AND s.session_type IN ('Race', 'Race 2', 'Race 3')
       GROUP BY c.name ORDER BY points DESC`,
    )
    .all(season) as { name: string; team: string; points: number; me: number }[]
  const myPos = standings.findIndex((s) => s.me === 1)
  const latest = weekends.at(-1)
  return {
    season,
    team: latest?.team ?? null,
    teammate: latest?.teammate ?? null,
    rounds,
    totals: {
      races: races.length,
      points: sum(races.map((r) => r.points)),
      teammatePoints: sum(races.map((r) => r.teammatePoints)),
      wins: races.filter((r) => r.race === 1).length,
      podiums: races.filter((r) => (r.race ?? 99) <= 3).length,
      poles: rounds.filter((r) => r.quali === 1).length,
      avgFinish: races.length
        ? Math.round((sum(races.map((r) => r.race)) / races.length) * 10) / 10
        : null,
      headToHead: {
        quali: h2h(
          (r) => r.quali,
          (r) => r.teammateQuali,
        ),
        race: h2h(
          (r) => r.race,
          (r) => r.teammateRace,
        ),
      },
    },
    teamPace: seasonTeamPace(db, season, latest?.team ?? null),
    standings: {
      note: 'Only races the app recorded count.',
      driverPosition: myPos >= 0 ? myPos + 1 : null,
      top: standings
        .slice(0, 5)
        .map((s, i) => `P${i + 1} ${s.name}${s.me ? ' (him)' : ''} (${s.team}) ${s.points}`),
    },
  }
}

/** One line for the start of a career session. */
export function careerBrief(db: HistoryDb, seasonLink: number): string | null {
  const c = careerView(db, seasonLink)
  if (!c || !c.rounds.length) return null
  const t = c.totals
  const mate = c.teammate
    ? ` vs ${c.teammate}: quali ${t.headToHead.quali}, race ${t.headToHead.race}, points ${t.points}-${t.teammatePoints}.`
    : ''
  const pace = c.teamPace.myTeam
    ? ` Car: ${c.teamPace.myTeam.expectation} (from ${c.teamPace.sessionsMeasured} session(s)).`
    : ''
  return `Career season with ${c.team ?? 'his team'}: ${c.rounds.length} round(s) so far, ${t.points} pts${c.standings.driverPosition ? `, P${c.standings.driverPosition} in the standings` : ''}, ${t.wins} win(s), ${t.podiums} podium(s).${mate}${pace}`
}
