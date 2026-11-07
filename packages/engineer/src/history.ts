import { type Options, query, tool } from '@anthropic-ai/claude-agent-sdk'
import {
  type HistoryDb,
  type Program,
  lapVsHistory,
  recentSessionsView,
  sessionDetailView,
  trackBrief,
  trackRecall,
} from '@gp/history'
import { type RaceSnapshot, type RaceState, TRACKS } from '@gp/telemetry'
import { z } from 'zod'

const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
})
const readOnly = { annotations: { readOnlyHint: true } }

function trackIdFor(name: string | undefined, s: RaceSnapshot): number | null {
  if (!name) return s.session?.trackId ?? null
  const n = name.toLowerCase()
  const hit = Object.entries(TRACKS).find(([, t]) => t.toLowerCase().includes(n))
  return hit ? Number(hit[0]) : null
}

/** Tools over the long-term history. Every one returns a compact digest, never raw telemetry. */
export function historyTools(history: HistoryDb, snapshot: () => RaceSnapshot) {
  return [
    tool(
      'get_track_history',
      "The driver's history at a track (default: the current one): sessions done, personal best lap and when, best sectors ever and the ideal lap, recent sessions there with best/typical pace and results, career results there. Use it for targets and to tell him how today compares.",
      { track: z.string().optional().describe('Track name, default the current track') },
      async ({ track }) => {
        const id = trackIdFor(track, snapshot())
        if (id === null) return json({ error: 'unknown track' })
        return json(trackRecall(history, id) ?? { note: 'no history at this track yet' })
      },
      readOnly,
    ),
    tool(
      'get_recent_sessions',
      "The driver's most recent sessions anywhere, newest first, with a one-line summary each. program 'sim' = time trial, one-off Grand Prix, events (his simulator work); 'career' = his career season.",
      {
        last: z.number().int().min(1).max(30).optional().describe('How many, default 8'),
        program: z.enum(['sim', 'career']).optional(),
      },
      async ({ last, program }) =>
        json(recentSessionsView(history, last ?? 8, program as Program | undefined)),
      readOnly,
    ),
    tool(
      'get_session_detail',
      'One past session in detail: every lap (time, validity, position, tyre), incidents (penalties, flashbacks, damage, places lost), teammate, result. Session ids come from get_recent_sessions or get_track_history.',
      { sessionId: z.number().int() },
      async ({ sessionId }) =>
        json(sessionDetailView(history, sessionId) ?? { error: 'no such session' }),
      readOnly,
    ),
    tool(
      'get_driver_profile',
      "Your running notes on the driver's strengths, weaknesses, habits and progress, built from his sessions.",
      {},
      async () => json(history.profile() ?? { note: 'no profile yet' }),
      readOnly,
    ),
  ]
}

export interface HistoryHooks {
  /** Extra text for a lap-completed event: new PB at this track, close to it. */
  lapNote: (lap: { lapTimeMs: number; valid: boolean }) => string | null
  stop: () => void
}

/**
 * Gives the engineer a short brief about the track once each new session's track is known,
 * and works out PB notes for radio lap events.
 */
export function attachHistory(
  state: RaceState,
  history: HistoryDb,
  addContext: (text: string) => void,
): HistoryHooks {
  let briefedUid: string | null = null
  let sessionBest = 0
  const timer = setInterval(() => {
    const s = state.snapshot().session
    if (!s || s.uid === briefedUid) return
    briefedUid = s.uid
    sessionBest = 0
    try {
      const brief = trackBrief(history, s.trackId)
      addContext(
        `New session: ${s.track} ${s.sessionType}. ${brief ?? `First time at ${s.track} as far as the history goes.`}`,
      )
    } catch (e) {
      console.error('[history] brief failed', e)
    }
  }, 1000)
  return {
    lapNote: (lap) => {
      const trackId = state.snapshot().session?.trackId
      if (trackId === undefined) return null
      try {
        const note = lapVsHistory(history, trackId, lap.lapTimeMs, lap.valid, sessionBest)
        if (lap.valid && lap.lapTimeMs > 0 && (!sessionBest || lap.lapTimeMs < sessionBest))
          sessionBest = lap.lapTimeMs
        return note
      } catch {
        return null
      }
    },
    stop: () => clearInterval(timer),
  }
}

const DEBRIEF_PROMPT = `You keep a race engineer's private notes on one sim racing driver (F1 23). You get the data for one session he just finished, his history at that track, and the current profile. Reply with JSON only, no prose around it:
{"summary": "...", "profile": "..."}

summary: one or two plain sentences on this session for the engineer's records. Facts and numbers: pace vs his PB and best sectors there, consistency, result, mistakes (flashbacks, penalties, places lost), and the single most useful thing to work on next. No praise words, no exclamation marks.

profile: the updated profile, at most 900 characters, exactly these four lines:
Strengths: ...
Working on: ...
Habits: ...
Progress: ...
Rules: only claim what the data across sessions supports; keep earlier points unless this session contradicts them; prefer specific, track-independent patterns (e.g. "lap 1 losses", "fades after 10 laps on a stint", "strong in high-speed sectors") over one-offs; note sim vs career only when it matters. If there is too little data, say so briefly in that line.`

/**
 * After a session is saved: a short summary for the records and an updated driver profile,
 * written by the cheap model in a one-off conversation (not the race conversation).
 */
export async function debriefSession(
  history: HistoryDb,
  sessionId: number,
  opts: { model?: string; cwd?: string; sdk?: Partial<Options> } = {},
): Promise<{ summary: string; profile: string } | null> {
  const detail = sessionDetailView(history, sessionId)
  if (!detail || detail.laps.length < 3) return null
  const trackId = (
    history.db.prepare('SELECT track_id FROM sessions WHERE id = ?').get(sessionId) as {
      track_id: number
    }
  ).track_id
  const prev = history.db
    .prepare(
      `SELECT MIN(l.lap_ms) AS pb FROM laps l JOIN sessions s ON s.id = l.session_id
       WHERE s.track_id = ? AND s.id != ? AND l.valid = 1 AND l.flashback = 0`,
    )
    .get(trackId, sessionId) as { pb: number | null }
  const recall = trackRecall(history, trackId, 4)
  const input = JSON.stringify({
    session: detail,
    previousPbAtTrackMs: prev.pb,
    trackHistory: recall && { ...recall, bestSectorsMs: undefined },
    currentProfile: history.profile()?.text ?? '(none yet)',
  })
  const q = query({
    prompt: input,
    options: {
      model: opts.model ?? 'haiku',
      systemPrompt: DEBRIEF_PROMPT,
      tools: [],
      settingSources: [],
      maxTurns: 1,
      persistSession: false,
      thinking: { type: 'disabled' },
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'gp-race-engineer/0.1' },
      ...opts.sdk,
    },
  })
  let text = ''
  for await (const m of q) if (m.type === 'result' && m.subtype === 'success') text = m.result
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  const out = JSON.parse(match[0]) as { summary?: string; profile?: string }
  if (!out.summary || !out.profile) return null
  history.setSummary(sessionId, out.summary.trim())
  // The model saw the current profile (including any edits he made) and refines it.
  history.setProfile(out.profile.slice(0, 1200), 'engineer')
  return { summary: out.summary.trim(), profile: out.profile.trim() }
}
