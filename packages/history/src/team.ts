import type { HistoryDb } from './db.ts'

export interface TeamPace {
  team: string
  bestMs: number
  rank: number
  /** % slower than the fastest team's best lap. */
  gapPct: number
}

/** Rank teams by their quicker car's best lap. Cars without a lap are ignored. */
export function rankTeams(cars: { team: string; bestLapMs: number }[]): TeamPace[] {
  const best = new Map<string, number>()
  for (const c of cars) {
    if (!c.team || c.bestLapMs <= 0) continue
    const cur = best.get(c.team)
    if (cur === undefined || c.bestLapMs < cur) best.set(c.team, c.bestLapMs)
  }
  const sorted = [...best.entries()].sort((a, b) => a[1] - b[1])
  const fastest = sorted[0]?.[1] ?? 0
  return sorted.map(([team, ms], i) => ({
    team,
    bestMs: ms,
    rank: i + 1,
    gapPct: fastest ? Math.round(((ms - fastest) / fastest) * 1000) / 10 : 0,
  }))
}

/** Where a car ranked Nth of the teams naturally finishes, with two cars per team. */
export function expectedRange(rank: number, teams: number): string {
  const lo = 2 * rank - 1
  const hi = 2 * rank
  const where =
    rank <= 2
      ? 'fighting for wins and podiums'
      : rank <= 4
        ? 'podiums on a good day, points every race'
        : rank <= 6
          ? 'solid points; a podium is a special day'
          : rank <= 8
            ? 'the last points places are a good result'
            : 'points are a great day; beating the teammate and the cars around is the job'
  return `car is about P${rank} of ${teams} teams on pace: it naturally finishes around P${lo}-P${hi}; ${where}`
}

/**
 * How quick his team's car is relative to the field across a career season, from the best
 * laps of every car in each recorded session (practice, quali and race), plus the
 * constructors' points from recorded races.
 */
export function seasonTeamPace(db: HistoryDb, seasonLink: number, myTeam: string | null) {
  const sessions = db.db
    .prepare(
      `SELECT s.id, s.session_type FROM sessions s
       WHERE s.program = 'career' AND s.season_link = ?
         AND EXISTS (SELECT 1 FROM classification c WHERE c.session_id = s.id AND c.best_lap_ms > 0)`,
    )
    .all(seasonLink) as { id: number; session_type: string }[]
  const agg = new Map<string, { ranks: number[]; gaps: number[] }>()
  let teamsSeen = 0
  for (const s of sessions) {
    const cars = db.db
      .prepare('SELECT team, best_lap_ms FROM classification WHERE session_id = ?')
      .all(s.id) as { team: string; best_lap_ms: number | null }[]
    const ranked = rankTeams(cars.map((c) => ({ team: c.team, bestLapMs: c.best_lap_ms ?? 0 })))
    teamsSeen = Math.max(teamsSeen, ranked.length)
    for (const r of ranked) {
      const a = agg.get(r.team) ?? { ranks: [], gaps: [] }
      a.ranks.push(r.rank)
      a.gaps.push(r.gapPct)
      agg.set(r.team, a)
    }
  }
  const avg = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10
  const ranking = [...agg.entries()]
    .map(([team, a]) => ({ team, avgRank: avg(a.ranks), avgGapPct: avg(a.gaps) }))
    .sort((a, b) => a.avgRank - b.avgRank)
  const mine = myTeam ? ranking.findIndex((r) => r.team === myTeam) : -1
  const constructors = db.db
    .prepare(
      `SELECT c.team, SUM(c.points) AS points FROM classification c JOIN sessions s ON s.id = c.session_id
       WHERE s.program = 'career' AND s.season_link = ? AND s.session_type IN ('Race', 'Race 2', 'Race 3')
       GROUP BY c.team ORDER BY points DESC`,
    )
    .all(seasonLink) as { team: string; points: number }[]
  const myConstructors = myTeam ? constructors.findIndex((c) => c.team === myTeam) : -1
  return {
    sessionsMeasured: sessions.length,
    note: "Pace rank = where each team's quicker car ranked on best lap, averaged over recorded career sessions (practice, quali, race). Standings only count races the app recorded.",
    myTeam:
      mine >= 0
        ? {
            team: myTeam,
            paceRank: mine + 1,
            of: ranking.length,
            avgGapToFastestPct: ranking[mine]!.avgGapPct,
            expectation: expectedRange(mine + 1, Math.max(ranking.length, teamsSeen)),
            constructorsPosition: myConstructors >= 0 ? myConstructors + 1 : null,
          }
        : null,
    paceRanking: ranking.map(
      (r, i) => `${i + 1}. ${r.team} (avg rank ${r.avgRank}, +${r.avgGapPct}%)`,
    ),
    constructors: constructors.map((c, i) => `P${i + 1} ${c.team} ${c.points}`),
  }
}
