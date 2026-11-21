# GP design system

Source: `packages/ui` (`@gp/ui`). Living style guide: `pnpm --filter @gp/ui styleguide` builds
`packages/ui/dist/styleguide/index.html` and opens it (macOS). Screenshots: `pnpm --filter @gp/ui screenshot`
(needs Playwright).

Status (2026-11-21, v2): the debrief app. Carbon palette with no blue cast, a motion language,
and the components the new screens use (app shell, status checks, splash, session list, chat,
settings controls). Designs: the GP screens canvas (https://claude.ai/artifact/52YARWsg6T2tRfBVrRBer4)
and the GP design system artifact (https://claude.ai/artifact/G2sCJmEf4LBnCHj3JAXioW); v2 of the
artifact leads, this package follows it. Anything else is added when a real screen needs it.

## Direction

- **F1 colours, calm.** Carbon black surfaces with no blue cast (`#0e0e10` window, `#17171a`
  panels), white text, one F1 red (`#e10600`). Nothing vibe-coded: no blue accents, no gradients
  on controls, no glow.
- **Red is a line or a dot.** The current nav mark, a live dot, the splash progress hairline, the
  mark's centre bar. Never a filled button, banner or slab.
- **Team colour is data.** A 3px tick beside a session or car, chart values, the radio card.
- **Broadcast look, calm.** The display face and the radio card follow the F1 TV team-radio
  cards. No italics, no red slabs, no slanted shapes (Rohit called those "arcadey").
- **No borrowed marks.** GP draws its own shapes. No F1, FIA, team or sponsor logos, and the
  official broadcast font is never bundled.
- **Dark only** until a screen needs a light theme.

## Tokens (`src/tokens.ts`)

TS is the source of truth; the build emits CSS custom properties `--gp-<group>-<name>` into
`dist/gp-ui.css`. Components use the semantic groups, never `palette`.

| Group | What's in it |
| --- | --- |
| `color` | `bg`, `surface`, `surface-raised`, `surface-hover`, `border`, `border-strong` (control edges at 3:1), `edge`, `text`, `text-muted`, `text-faint`, `accent` (red), `accent-text`, `focus-ring`, `good`/`warn`/`bad`, `timing-overall`/`-personal`/`-slower` |
| `team` | Team colours keyed by F1 23 team id (`--gp-team-0` … `--gp-team-9`). `teamColor(id)` falls back to GP red |
| `font` | `display` (GP Display), `sans` (Inter), `mono`, `stretch` 125%, weights 400/500/600/800 |
| `type` | `caption` 11/14, `body` 13/20, `title` 18/24, `quote` 17/19, `name` 28/26, `number` 60/52 |
| `space` | 4px grid: 1=4 … 10=40 |
| `radius` | `sm` 2px (broadcast cards), `md` 6px (app controls), `lg` 12px (chat bubbles) |
| `shadow` | `pop`: floating things only (menus, toasts) |
| `motion` | `instant` 80ms (press), `fast` 140ms (hover), `base` 200ms (state), `page` 280ms (page enter), `slow` 320ms (charts, radio card), `fade-out` 600ms, `stagger` 40ms per list item, `rise` 8px; `ease` for enter, `ease-in` for leave, `ease-inout` for loops |

Motion rules: every change moves and every move is calm. Pages rise in (`.gp-page`), lists and
check rows stagger (`.gp-enter` with `--i`), status changes recolour in place (a check goes
pending ring, spinning arc, filled with a glyph), presses scale to 0.97. No overshoot or bounce;
only live state loops (live dot, mic level, typing). `prefers-reduced-motion` cuts all of it.

Colour rules:
- Red marks the primary action, live state and push-to-talk. Never a filled block on the overlay.
- Purple/green/yellow mean what they mean on F1 timing screens, only on timing data.
- Team colours are data (the radio card, names). Some are blue; blue is never a UI accent, and a
  test enforces that.

## Type

- **GP Display** = bundled Saira (OFL) at 125% width, upright, tabular figures. Used for names,
  numbers, labels and the radio card (`.gp-display`, `.gp-label`).
- **Inter** for plain UI text: forms, notes, long copy.
- Broadcast names and numbers are 800; everything else 400 to 600.

## Radio card (`radioCard`, `animateWaveform`)

```ts
radioCard({ driver: 'Piastri', number: 81, teamId: 8, lines: [
  { who: 'gp', text: 'Remember to use the drink' },
  { who: 'driver', text: 'I would if it was working' },
] })
```

- Top right: the driver's surname in team colour over a white RADIO (like NORRIS RADIO on TV),
  two tight lines. In the app this is your driver's name from the game, never "GP".
- Band: big car number in team colour, left, sitting on a stepped waveform that fades to the right.
- Quotes in caps: GP's lines white and left, yours in team colour and right.
- Team colour comes from your car in the telemetry (`--gp-team` on the card).
- Height follows content. All sizes are `em` off the card's 16px, so changing `font-size` scales
  the whole card.
- `animateWaveform(card, level)` drives the bars from a 0..1 level; static when not speaking or
  with reduced motion.

## Accessibility

- Text roles pass 4.5:1 on every surface; team colours pass 3:1 on the card (tested).
- White 2px `:focus-visible` ring inside `.gp-app`.
- `prefers-reduced-motion` cuts transitions and stops the waveform.

## Local skin (your own font, never committed)

Put font files you own in `~/Documents/GP/skin/` (or set `GP_SKIN_DIR`). The style-guide build
(`pnpm --filter @gp/ui styleguide`) copies them into its local `dist/` only and registers them as
`'GP Skin Display'`, which the display token tries before the bundled Saira. Weight comes from the
file name: `Regular` 400, `Bold` 700, `Wide` 800 (the cut the TV names use), `Black` 900; italics
are skipped. A `skin.css` there is appended too, for `--gp-*` overrides. Use a face with tabular
figures. The desktop app will load the same folder when it moves onto `@gp/ui`. These files never
go into the repo or a release.

## App controls (`src/app.css`)

Added when the dashboard moved over; CSS classes only, no builders.

| Class | Use |
| --- | --- |
| `.gp-button` (`--primary`, `aria-pressed`) | Quiet bordered button; primary = white fill, one per screen |
| `.gp-dot` (`--live`, `--warn`) | Status dot. Red only for live and recording |
| `.gp-tabs` / `.gp-tab[aria-selected]` | Text tabs with a white underline |
| `.gp-panel` | Surface with a `.gp-label` title |
| `.gp-stats` / `.gp-stat` (`--big`) | Label over value, display face, tabular figures |
| `.gp-table` (`.num`) | Hairline rows, caps header, tabular figures |
| `.gp-input` | Text field, textarea, select. Filled (raised surface), 36px, soft white focus ring |
| `.gp-field` (`-label`, `-hint`) | Caps label above a field, optional hint below |
| `.gp-composer` | Select + inputs + one button joined into one 40px control (add a note, chat) |

`gpMark({ size, tile, label })` (`src/mark.ts`) draws the app icon's six bars (tallest one red)
as SVG; the header lockup is the bare mark at 18px next to "GP".

## v2 components (`src/components.css`)

CSS classes; markup is built in the renderer. Motion primitives (`.gp-enter`, `.gp-fade-in`,
`.gp-pop`, `.gp-page`), `.gp-spinner`, `.gp-kbd`, app shell (`.gp-shell`, `.gp-nav`,
`.gp-nav-item[aria-current]`, `.gp-topbar`, `.gp-statusline`, `.gp-content`), `.gp-banner`,
`.gp-chip`, `.gp-team-tick`, `.gp-seg`, `.gp-switch`, `.gp-setting`, session list (`.gp-list-*`),
lap chart, sector bar, bar meter, mic level (`.gp-level`, `[data-real]` driven by `--h`),
status checks (`.gp-checks`, `.gp-check[data-state]`), chat (`.gp-msg-*`, `.gp-typing`),
`.gp-empty`, `.gp-skel`, `.gp-splash`, `.gp-steps`.

## In the desktop app

- `apps/desktop/build.mjs` builds `@gp/ui` and copies `gp-ui.css` and `fonts/` next to the
  renderer HTML. Pages put `class="gp-app"` on the body.
- **Overlay radio card** (`renderer/radio.ts`, `main/radio-card.ts`): a transparent,
  click-through, non-focusable panel in the top right. It shows when GP speaks a call or answer,
  or you ask over push-to-talk (typed chat stays in the chat panel). Name, number and team colour
  come from your car in the telemetry ('Team' before the game names you). An answer joins your
  question on one card; any other line replaces the card. It holds 4.5 to 9 s by length (longer
  while GP is still talking, 30 s at most), fades over 600 ms, then the window hides. The
  waveform follows GP's voice level, relayed from the dashboard's audio. `GP_RADIO_CARD=0` turns
  it off.
- **Local skin:** the main process inlines `~/Documents/GP/skin` (fonts as data URLs plus
  `skin.css`, `src/skin.ts`) into every window at startup; restart GP after changing it.
