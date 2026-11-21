/**
 * GP design tokens: the single source of truth.
 *
 * `scripts/build.mjs` turns these into CSS custom properties (`--gp-*`) in dist/gp-ui.css.
 * Components and app code must use the semantic tokens (`color`, `overlay`, ...), never the
 * primitives (`palette`) directly. See docs/DESIGN.md for the rules.
 *
 * Direction "Pit wall + broadcast": graphite from the app icon, white text, one red (#e10600),
 * with structure borrowed from F1 TV timing graphics (light name bars, position tabs, team-colour
 * bars, big numbers, sector ticks), kept quiet: upright type, weights 400-600, red used thin. No blue, teal or cyan in the UI itself; the only blues
 * are data colours (some teams, the wet tyre).
 */

/** Raw palette. Only referenced from this file. */
export const palette = {
  graphite: {
    0: '#08090b',
    50: '#0e1013',
    100: '#15171c', // app icon background
    150: '#1b1e24',
    200: '#22262d',
    300: '#2d323a',
    400: '#3b414b',
    500: '#59606b',
    600: '#7d8590',
    700: '#a1a7b0',
    800: '#c8ccd2',
    900: '#e6e8eb',
    950: '#f4f5f7',
  },
  red: {
    300: '#ff8a80',
    400: '#ff4d3d', // red that passes AA as text on graphite
    500: '#e10600', // F1 red, the brand accent
    600: '#bd0500',
    700: '#8f0400',
    900: '#2a0d0c',
  },
  purple: { 400: '#b77dff', 900: '#211531' },
  green: { 400: '#35d07a', 900: '#0f2419' },
  yellow: { 400: '#f5c518', 900: '#2a2410' },
  amber: { 400: '#ffa233', 900: '#2b1c0b' },
  white: '#ffffff',
} as const

const g = palette.graphite

/** Semantic colour roles for the app (Garage, Review, settings). */
export const color = {
  bg: g[50],
  surface: g[100],
  surfaceRaised: g[150],
  surfaceSunken: g[0],
  surfaceHover: g[200],
  surfaceActive: g[300],
  border: g[200],
  borderStrong: g[400],
  text: g[950],
  textMuted: g[700],
  textFaint: g[600],
  textDisabled: g[500],
  textOnAccent: palette.white,

  accent: palette.red[500],
  accentHover: palette.red[600],
  accentActive: palette.red[700],
  accentText: palette.red[400],
  accentSubtle: palette.red[900],

  focusRing: g[950],
  focusRingAccent: palette.red[500],

  // Status (not timing): telemetry live, warnings, failures.
  good: palette.green[400],
  goodSubtle: palette.green[900],
  warn: palette.amber[400],
  warnSubtle: palette.amber[900],
  bad: palette.red[400],
  badSubtle: palette.red[900],
  neutral: g[600],
  neutralSubtle: g[200],

  // Timing semantics, same meaning as the F1 timing screens.
  timingOverall: palette.purple[400], // fastest of anyone
  timingOverallSubtle: palette.purple[900],
  timingPersonal: palette.green[400], // your personal best
  timingPersonalSubtle: palette.green[900],
  timingSlower: palette.yellow[400], // slower than your best
  timingSlowerSubtle: palette.yellow[900],
  timingInvalid: palette.red[400], // track limits, lap deleted
  timingNone: g[300], // sector not run yet

  // Gaps and deltas: ahead/faster is good, behind/slower is bad.
  deltaGain: palette.green[400],
  deltaLoss: palette.red[400],
  deltaEven: g[700],

  // Tyre compounds (data only). Wet is the one sanctioned blue in GP: it is Pirelli's colour.
  tyreSoft: '#ff3b30',
  tyreMedium: '#f5c518',
  tyreHard: g[950],
  tyreInter: '#35d07a',
  tyreWet: '#3a8dde',

  scrim: 'rgba(8, 9, 11, 0.72)',

  // Broadcast-style name bar: the light strip with the driver's name in dark caps.
  nameBar: g[950],
  nameBarText: g[50],
  nameBarMuted: g[500],
  bannerFastest: palette.purple[400],
  bannerFastestText: palette.white,
  bannerFastestBg: '#3b1d63',
} as const

/**
 * Team colours: data only (driver strips, tower rows). Keyed by F1 23 team id, the same ids as
 * TEAMS in @gp/telemetry. Unknown teams (F2, My Team) get `teamFallback`.
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
export const teamFallback = g[600]
export function teamColor(teamId: number | null | undefined): string {
  return (teamId != null && teamColors[teamId]) || teamFallback
}

/**
 * Overlay tokens: the floating panel over F1 23 while driving. Larger type, heavier weights,
 * an opaque-enough scrim to survive a bright sky behind it, and a fade cycle.
 */
export const overlay = {
  scrim: 'rgba(10, 11, 14, 0.86)',
  scrimStrong: 'rgba(10, 11, 14, 0.94)', // used when reduced transparency is on
  border: 'rgba(255, 255, 255, 0.10)',
  text: palette.white,
  textMuted: '#c8ccd2',
  accent: palette.red[500],
  /** GP's quoted lines on the radio card. Lighter than accentText to survive a white sky. */
  accentText: palette.red[300],
  textShadow: '0 1px 2px rgba(0, 0, 0, 0.9)',
  fontSizeLabel: '13px',
  fontSizeName: '20px',
  fontSizeBody: '18px',
  fontSizeCall: '26px',
  fontSizeReadout: '40px',
  fontSizeHero: '64px',
  fontWeightBody: '600',
  fontWeightCall: '600',
  fontWeightReadout: '500',
  padding: '12px 16px',
  accentBar: '2px',
  /** Radio card stays up this long after GP stops talking (ms, JS). */
  radioLingerMs: 4000,
  idleOpacity: '0.0',
  dimOpacity: '0.55',
  fadeIn: '120ms',
  fadeOut: '600ms',
  /** How long a call stays fully visible before dimming (ms, used by JS not CSS). */
  holdMs: 6000,
} as const

/**
 * Broadcast surfaces: the panel treatment for strips, tower, radio card and banners, modelled on
 * the 2025/26 TV look (dark graded panels, square corners, faint texture, slow sheen). All drawn
 * with gradients; no image assets.
 */
export const broadcast = {
  panel:
    'linear-gradient(180deg, rgba(34, 38, 45, 0.96) 0%, rgba(17, 19, 23, 0.97) 55%, rgba(10, 11, 14, 0.98) 100%)',
  texture:
    'repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.025) 0 1px, transparent 1px 5px)',
  headPanel: 'linear-gradient(180deg, rgba(44, 49, 58, 0.97) 0%, rgba(26, 29, 35, 0.97) 100%)',
  nameBar: 'linear-gradient(180deg, #ffffff 0%, #e9ebee 100%)',
  rowDivider: 'rgba(255, 255, 255, 0.06)',
  edge: 'rgba(255, 255, 255, 0.07)',
  edgeTop: 'rgba(255, 255, 255, 0.12)',
  meRow:
    'linear-gradient(90deg, rgba(225, 6, 0, 0.22) 0%, rgba(225, 6, 0, 0.04) 60%, transparent 100%)',
  sheen:
    'linear-gradient(105deg, transparent 0%, transparent 40%, rgba(255, 255, 255, 0.06) 50%, transparent 60%, transparent 100%)',
  sheenDuration: '9s',
  radius: '0',
  shadow: '0 10px 30px rgba(0, 0, 0, 0.45)',
} as const

export const font = {
  /**
   * Display face for numbers, driver names, labels and the whole overlay. 'GP Display' is the
   * bundled Saira (OFL, variable weight and width), set expanded: the closest free match to the
   * broadcast face. To use a licensed broadcast font, install
   * it and put its family name first here, or define 'GP Skin Display' in the local skin
   * (docs/DESIGN.md, "Local skin"). It must have tabular figures or lap times will jitter.
   */
  display:
    "'GP Skin Display', 'GP Display', 'Saira Variable', Saira, 'Inter Variable', -apple-system, sans-serif",
  /** Width for names and labels in the display face: fully expanded, like broadcast type. */
  stretchWide: '125%',
  /** Width for numbers: expanded but a touch narrower so long times still fit. */
  stretchNum: '115%',
  /** Body text, forms, long notes. */
  sans: "'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  /** Applied to every number a driver compares: lap times, gaps, deltas, positions. */
  numericFeatures: "'tnum' 1",
  weightRegular: '400',
  weightMedium: '500',
  weightSemibold: '600',
  weightBold: '700',
} as const

/** Type scale for the app window. [size, line-height]. */
export const type = {
  caption: ['11px', '14px'],
  small: ['12px', '16px'],
  body: ['13px', '20px'],
  bodyLg: ['15px', '22px'],
  title: ['18px', '24px'],
  heading: ['22px', '28px'],
  display: ['28px', '34px'],
  numSm: ['15px', '20px'],
  numMd: ['22px', '26px'],
  numLg: ['34px', '38px'],
  numXl: ['48px', '52px'],
} as const

export const tracking = {
  tight: '-0.01em',
  normal: '0',
  label: '0.08em', // uppercase labels only
} as const

/** 4px grid. */
export const space = {
  0: '0',
  0.5: '2px',
  1: '4px',
  1.5: '6px',
  2: '8px',
  2.5: '10px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
} as const

export const radius = {
  xs: '2px',
  sm: '4px',
  md: '6px',
  lg: '10px',
  xl: '14px',
  pill: '999px',
} as const

/** Dark UI: depth comes from surface steps plus a thin top highlight, shadows stay subtle. */
export const elevation = {
  0: 'none',
  1: 'inset 0 1px 0 rgba(255, 255, 255, 0.03), 0 1px 2px rgba(0, 0, 0, 0.4)',
  2: 'inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 6px 20px rgba(0, 0, 0, 0.45)',
  3: 'inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 16px 48px rgba(0, 0, 0, 0.6)',
} as const

export const motion = {
  instant: '80ms',
  fast: '140ms',
  base: '200ms',
  slow: '320ms',
  easeStandard: 'cubic-bezier(0.2, 0, 0, 1)',
  easeEnter: 'cubic-bezier(0, 0, 0.2, 1)',
  easeExit: 'cubic-bezier(0.4, 0, 1, 1)',
} as const

export const z = {
  base: '0',
  sticky: '10',
  popover: '100',
  toast: '200',
} as const

export const tokens = {
  palette,
  color,
  team: teamColors,
  broadcast,
  overlay,
  font,
  type,
  tracking,
  space,
  radius,
  elevation,
  motion,
  z,
}
export type Tokens = typeof tokens
