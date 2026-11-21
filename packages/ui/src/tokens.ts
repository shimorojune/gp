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
  /** Carbon: neutral greys with no blue cast (v2). */
  ink: {
    0: '#0e0e10',
    100: '#17171a',
    200: '#202024',
    250: '#28282d',
    300: '#2e2e33',
    400: '#66666d',
    500: '#8c8c94',
    700: '#b3b3b9',
    900: '#f5f5f6',
  },
  red: { 400: '#ff4d3d', 500: '#e10600' },
  purple: '#b77dff',
  green: '#35d07a',
  statusGreen: '#2fcf72',
  yellow: '#f5c518',
  amber: '#ffa62b',
  white: '#ffffff',
} as const

const ink = palette.ink

export const color = {
  bg: ink[0],
  surface: ink[100],
  surfaceRaised: ink[200],
  /** Hover on raised things, the selected segment, switch track off. */
  surfaceHover: ink[250],
  border: ink[300],
  /** Control edges that must read at 3:1 (switch, segmented, chart baseline). */
  borderStrong: ink[400],
  /** The thin light edge around broadcast cards. */
  edge: 'rgba(255, 255, 255, 0.16)',
  text: ink[900],
  textMuted: ink[700],
  textFaint: ink[500],
  accent: palette.red[500],
  accentText: palette.red[400],
  focusRing: ink[900],
  good: palette.statusGreen,
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
  10: '40px',
} as const

export const radius = {
  sm: '2px',
  md: '6px',
  lg: '12px',
} as const

/** Floating things only: menus, toasts. */
export const shadow = {
  pop: '0 8px 24px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.06)',
} as const

/** One calm language: enter = ease, exit = ease-in, no overshoot. docs/DESIGN.md, Motion. */
export const motion = {
  instant: '80ms',
  fast: '140ms',
  base: '200ms',
  slow: '320ms',
  page: '280ms',
  fadeOut: '600ms',
  stagger: '40ms',
  rise: '8px',
  ease: 'cubic-bezier(0.2, 0, 0, 1)',
  easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
  easeInout: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const

export const tokens = { color, team: teamColors, font, type, space, radius, shadow, motion }
export type Tokens = typeof tokens
