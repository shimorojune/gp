/**
 * GP design tokens: the single source of truth. `scripts/build.mjs` turns them into CSS custom
 * properties (`--gp-<group>-<name>`) in dist/gp-ui.css. Components use the semantic groups,
 * never `palette` directly. Rules: docs/DESIGN.md.
 *
 * Base minimum on purpose: colour, type, space, radius, motion, plus the radio card. Everything
 * else gets added when a real screen needs it.
 */

/** Raw palette. Only referenced from this file. */
export const palette = {
  ink: {
    0: '#0b0c10',
    100: '#15161d', // card background, close to the app icon (#15171c)
    200: '#1f2129',
    300: '#2c2f39',
    500: '#5d616d',
    700: '#a3a7b1',
    900: '#f4f5f7',
  },
  red: { 400: '#ff4d3d', 500: '#e10600' },
  purple: '#b77dff',
  green: '#35d07a',
  yellow: '#f5c518',
  amber: '#ffa233',
  white: '#ffffff',
} as const

const ink = palette.ink

export const color = {
  bg: ink[0],
  surface: ink[100],
  surfaceRaised: ink[200],
  border: ink[300],
  /** The thin light edge around broadcast cards. */
  edge: 'rgba(255, 255, 255, 0.16)',
  text: ink[900],
  textMuted: ink[700],
  textFaint: ink[500],
  accent: palette.red[500],
  accentText: palette.red[400],
  focusRing: ink[900],
  good: palette.green,
  warn: palette.amber,
  bad: palette.red[400],
  // Timing, same meaning as F1 timing screens. Data only.
  timingOverall: palette.purple,
  timingPersonal: palette.green,
  timingSlower: palette.yellow,
} as const

/**
 * Team colours (data only), keyed by F1 23 team id, same ids as TEAMS in @gp/telemetry.
 * Some are blue; that's the team's colour, never a UI accent.
 */
export const teamColors: Record<number, string> = {
  0: '#27f4d2', // Mercedes
  1: '#e8002d', // Ferrari
  2: '#3671c6', // Red Bull Racing
  3: '#64c4ff', // Williams
  4: '#229971', // Aston Martin
  5: '#ff87bc', // Alpine
  6: '#6692ff', // AlphaTauri
  7: '#b6babd', // Haas
  8: '#ff8000', // McLaren
  9: '#c92d4b', // Alfa Romeo
}
/** Team colour for an F1 23 team id; GP red when unknown (F2, My Team). */
export function teamColor(teamId: number | null | undefined): string {
  return (teamId != null && teamColors[teamId]) || color.accent
}

export const font = {
  /**
   * Broadcast face: names, numbers, labels, the radio card. 'GP Display' is the bundled Saira
   * (OFL), the closest free match to the TV font. 'GP Skin Display' is tried first so a
   * licensed font can be dropped in locally (docs/DESIGN.md, "Local skin").
   */
  display: "'GP Skin Display', 'GP Display', 'Saira Variable', Saira, -apple-system, sans-serif",
  /** Plain UI text: forms, notes, long copy. */
  sans: "'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, sans-serif",
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  /** Expanded width used for every display-face string. */
  stretch: '125%',
  numeric: "'tnum' 1",
  regular: '400',
  medium: '500',
  semibold: '600',
  heavy: '800',
} as const

/** Type scale: [size, line-height]. Display sizes are for the broadcast face. */
export const type = {
  caption: ['11px', '14px'],
  body: ['13px', '20px'],
  title: ['18px', '24px'],
  quote: ['17px', '19px'],
  name: ['28px', '26px'],
  number: ['60px', '52px'],
} as const

/** 4px grid. */
export const space = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
} as const

export const radius = {
  sm: '2px',
  md: '6px',
} as const

export const motion = {
  fast: '140ms',
  base: '200ms',
  fadeOut: '600ms',
  ease: 'cubic-bezier(0.2, 0, 0, 1)',
} as const

export const tokens = { color, team: teamColors, font, type, space, radius, motion }
export type Tokens = typeof tokens
