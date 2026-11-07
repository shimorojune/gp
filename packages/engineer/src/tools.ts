import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import type { RaceSnapshot } from '@gp/telemetry'
import { z } from 'zod'
import type { NoteCategory, NotesStore } from './notes.ts'
import {
  carStatusView,
  lapHistoryView,
  orderView,
  paceTargetsView,
  raceSnapshotView,
  setupView,
  tyreSetsView,
  weatherView,
} from './views.ts'

export const RACE_SERVER = 'race'

const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
})

export interface ToolDeps {
  snapshot: () => RaceSnapshot
  notes: NotesStore
}

const categories = ['driving', 'setup', 'radio', 'strategy', 'personal', 'track'] as const

/** In-process MCP server exposing live race data and the notes memory to the engineer. */
export function createRaceTools({ snapshot, notes }: ToolDeps) {
  const readOnly = { annotations: { readOnlyHint: true } }
  const tools = [
    tool(
      'get_race_snapshot',
      'Current situation for the driver: session, lap, position, gaps ahead/behind, tyre, wear, fuel margin, ERS, pit window, penalties. Call this first for almost any race question.',
      {},
      async () => json(raceSnapshotView(snapshot())),
      readOnly,
    ),
    tool(
      'get_lap_history',
      "The driver's completed laps this session with sectors, validity, tyre and fuel.",
      {
        last: z
          .number()
          .int()
          .min(1)
          .max(60)
          .optional()
          .describe('How many recent laps, default 15'),
      },
      async ({ last }) => json(lapHistoryView(snapshot(), last ?? 15)),
      readOnly,
    ),
    tool(
      'get_running_order',
      'Running order with gaps, last/best laps, tyres, tyre age, stops and stint history for every car. Use `around` to only get cars near the driver.',
      {
        around: z
          .number()
          .int()
          .min(1)
          .max(21)
          .optional()
          .describe('Cars either side of the driver'),
      },
      async ({ around }) => json(orderView(snapshot(), around)),
      readOnly,
    ),
    tool(
      'get_pace_targets',
      'Targets for the driver: best and ideal lap (best sectors), last lap vs best sectors (where the time is), and chase/defend maths: gap to the car ahead and behind, gap change per lap, laps to catch, lap time needed to catch in 5 laps.',
      {},
      async () => json(paceTargetsView(snapshot())),
      readOnly,
    ),
    tool(
      'get_car_status',
      "Driver's car in detail: tyre wear/temps/pressures per corner, brake temps, fuel, ERS, brake bias, damage.",
      {},
      async () => json(carStatusView(snapshot())),
      readOnly,
    ),
    tool(
      'get_weather',
      'Current weather, temperatures, and the forecast for this session (minutes ahead, rain %).',
      {},
      async () => json(weatherView(snapshot())),
      readOnly,
    ),
    tool(
      'get_setup',
      "Driver's current car setup (wings, diff, camber/toe, suspension, ARBs, ride height, brakes, tyre pressures, fuel load).",
      {},
      async () => json(setupView(snapshot())),
      readOnly,
    ),
    tool(
      'get_tyre_sets',
      'Tyre sets available to the driver with wear, usable life and expected lap delta vs the fitted set (ms, negative = faster).',
      {},
      async () => json(tyreSetsView(snapshot())),
      readOnly,
    ),
    tool(
      'remember_note',
      'Save something worth remembering about the driver for future sessions: a preference ("hates sector times on the radio"), a habit seen in data, a running joke, a setup preference. Keep it one short sentence. Use source "driver" when they said it, "engineer" when you inferred it.',
      {
        category: z.enum(categories),
        text: z.string().min(3).max(300),
        source: z.enum(['driver', 'engineer']),
        track: z.string().optional().describe('Track name, only for category "track"'),
      },
      async ({ category, text, source, track }) =>
        json(notes.add({ category: category as NoteCategory, text, source, track: track ?? null })),
    ),
    tool(
      'list_notes',
      'Everything currently remembered about the driver, with ids.',
      {},
      async () =>
        json(
          notes.all().map(({ id, category, track, text, source }) => ({
            id,
            category,
            track,
            text,
            source,
          })),
        ),
      readOnly,
    ),
    tool(
      'forget_note',
      'Delete a remembered note by id (when the driver says it is wrong or asks you to forget it).',
      { id: z.string() },
      async ({ id }) => json({ removed: notes.remove(id) }),
    ),
  ]
  return {
    server: createSdkMcpServer({ name: RACE_SERVER, version: '0.1.0', tools, alwaysLoad: true }),
    toolNames: tools.map((t) => `mcp__${RACE_SERVER}__${t.name}`),
  }
}
