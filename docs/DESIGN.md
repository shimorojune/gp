# GP design system

Source: `packages/ui` (`@gp/ui`). Living style guide: `pnpm --filter @gp/ui styleguide` builds
`packages/ui/dist/styleguide/index.html` and opens it (macOS). Screenshots: `pnpm --filter @gp/ui screenshot`
(needs Playwright).

Status (2026-11-21): system built, not yet applied. The existing dashboard, overlay and Notes tab
still use their own inline CSS. Moving the screens onto `@gp/ui` is the next, separate step.

## Direction: pit wall calm, broadcast structure

- **Base ("Pit wall").** Graphite surfaces taken from the app icon (`#15171c`), white text, and one
  red (`#e10600`). The app should feel like a timing screen, not a dashboard template.
- **Broadcast structure.** Layout ideas come from F1 TV timing graphics: a light name bar with a
  position tab, a slanted team-colour bar, the driver name in italic caps, a big italic number
  with a smaller reference time beside it, sector ticks under it, a compact tower, a radio card
  with a waveform, and slanted banners.
- **No borrowed marks.** GP draws all of its own shapes. There are no F1, FIA, team or sponsor
  logos, and the official broadcast font is not bundled.
- **Dark only for now.** Dark is the primary theme. A light theme is not planned until a screen
  actually needs one.

## Principles

1. **Numbers are the hero.** Lap times, gaps and deltas get the biggest type. They use tabular
   figures so digits never jitter as they change, and they sit in the display face.
2. **One red.** Red marks only these things: the primary action, live/on-air state, push-to-talk,
   GP's radio lines, and your own row. If two red things compete on one screen, one of them is wrong.
3. **Colour has a meaning or it isn't there.**
   - Purple, green and yellow mean what they mean on F1 timing screens: overall best, personal
     best, slower. They appear only on timing data.
   - Status colours (good, warn, bad) are for system state.
   - Team and tyre colours are data, never decoration.
4. **No blue, teal or cyan in the UI.** The only blues allowed are data colours: some team
   colours and the wet tyre. A test enforces this for every UI colour role.
5. **The overlay says one thing at a time.** It never adds a second thing, and it gets out of the
   way (see Overlay rules below).
6. **Never colour alone.** Deltas carry an arrow and screen-reader text, invalid laps are struck
   through, and tyres carry a letter.

## Tokens

The single source of truth is `packages/ui/src/tokens.ts`. The build turns it into CSS custom
properties named `--gp-<group>-<name>` in `dist/gp-ui.css`.

| Group | Examples | Rule |
| --- | --- | --- |
| `palette` | `graphite[100]`, `red[500]` | Primitives only. Never used outside `tokens.ts` and never emitted as CSS. |
| `color` | `--gp-color-surface`, `--gp-color-text-muted`, `--gp-color-accent`, `--gp-color-timing-overall`, `--gp-color-delta-gain`, `--gp-color-name-bar` | Semantic roles. Components use these. |
| `team` | `--gp-team-8` / `teamColor(8)` | Keyed by the F1 23 team id (same ids as `TEAMS` in `@gp/telemetry`). Passed to components as data via `--gp-team`. |
| `overlay` | `--gp-overlay-scrim`, `--gp-overlay-font-size-call`, `--gp-overlay-fade-out`, `holdMs` | Overlay-only set: bigger type, heavier weights, a scrim that survives a white sky, and fade timing. |
| `font` | `--gp-font-display`, `--gp-font-sans`, `--gp-font-numeric-features` | See Type below. |
| `type` | `--gp-type-body-size` / `-line`, `--gp-type-num-lg-size` | App type scale. `num*` sizes are for numbers. |
| `space` | `--gp-space-1` (4px) … `--gp-space-16` | 4px grid. `space-0-5` = 2px, `space-1-5` = 6px, `space-2-5` = 10px. |
| `radius` | `xs 2 · sm 4 · md 6 · lg 10 · xl 14 · pill` | Broadcast strips use 4px, buttons and inputs 6px, cards 10px, the overlay panel 14px. |
| `elevation` | `--gp-elevation-1..3` | Depth comes mostly from surface steps. Shadows are for floating things such as toasts, strips and the overlay. |
| `motion` | `instant 80 · fast 140 · base 200 · slow 320`, standard/enter/exit easing | UI transitions stay at 200ms or under. |
| `z` | `sticky 10 · popover 100 · toast 200` | |

Token rules:
- **No hex in component CSS.** Components never hard-code colours, and a test checks this.
- **Only defined tokens.** Components only reference `--gp-*` names that exist (also tested). The
  one exception is `--gp-team`, which is passed in per element.
- **Add a role before a colour.** New colours go into `palette` first and then get a semantic role.
- **Contrast is tested** (`packages/ui/test/tokens.test.ts`):
  - All text roles meet at least 4.5:1 on every surface.
  - `textFaint` meets 3:1 and is for hints and placeholders only.
  - Overlay text meets at least 7:1, and muted overlay text and GP's lines at least 4.5:1, with
    the scrim composited over a white, bright-grey or red background.

## Type

- **Display face: `--gp-font-display`.** This is "GP Display", a bundled copy of **Saira**
  (OFL, variable weight, true italics, tabular figures).
  - Use it for every number a driver compares, driver names, uppercase labels, tabs, and the
    whole overlay.
  - Big numbers are italic and bold. Driver names are italic caps at weight 800.
- **Body face: `--gp-font-sans`.** This is **Inter**, bundled. Use it for body text, forms and
  long notes in Garage and Review.
- **Both faces are bundled.** The woff2 files are copied into `dist/fonts`, latin and latin-ext
  only (so names like Hülkenberg and Pérez render), so everything works offline.
- **Numbers always use tabular figures.** Use `.gp-num`, or any timing component, which sets
  `font-variant-numeric: tabular-nums`. The candidate fonts were checked for this: Chakra Petch
  was rejected because its digits differ in width.
- **Swapping the display font.** To use a licensed broadcast font, install it and put its family
  name first in `font.display`. Check that it has tabular figures first.

## Components

The CSS lives in `components.css` (core) and `broadcast.css`. The TypeScript lives in
`components.ts`, `broadcast.ts` and `behaviors.ts`.

- **Builders.** Components are framework-free HTML-string builders, matching how the renderer
  already uses `innerHTML`. They escape all text; to pass markup through, wrap it with `raw()`.
- **Opt-in classes.** Every class is prefixed `.gp-`, so loading the stylesheet changes nothing
  until markup opts in. `body.gp-app` applies the base font and background.

| Component | Builder | Notes |
| --- | --- | --- |
| Button | `button()` | Variants: primary (red, one per view), secondary, ghost, danger. Sizes sm, md, lg. Supports `aria-pressed` toggles. |
| Tabs | `tabs()`, `tabPanel()`, `bindTabs()` | Line or segmented (the segmented style is for the Garage/Race/Review mode switch). ARIA tabs with arrow keys, Home and End. |
| Card | `card()` | Raised and flush variants. The header uses an uppercase label. |
| Stat readout | `stat()` | Label, value, unit and sub-line, in sm, md or lg. Use `.gp-stat-grid` to lay them out. |
| Lap time | `lapTime()` | Kinds: overall, personal, slower, invalid (struck through, with screen-reader text), and empty (`--:--.---`). |
| Delta | `delta()`, `deltaKind()` | Shows an arrow and a sign. `lowerIsBetter` flips the meaning for gaps where bigger is better. Under 5ms reads as even. |
| Gap | `gap()` | Gap to the car ahead or behind with a trend bar. Closing on the car ahead is green; the car behind closing on you is red. |
| Sector bars | `sectors()` | States: overall, personal, slower, invalid (hatched), current (outlined) and none. |
| Status dot and pill | `statusDot()`, `pill()` | States: good, warn, bad, neutral, live (red, can pulse) and off. |
| Tyre | `tyre()` | A compound ring with its letter. |
| Field | `field()` | Input, textarea or select, with a label, hint and error. Wired with `aria-describedby` and `aria-invalid`. |
| List | `list()` | Interactive rows. `aria-current` marks the current row with a red edge. |
| Table | `table()` | Tabular numbers, a sticky header, and a "me" row with a red edge. |
| Toast | `toast()` | Kinds: info, good, warn, bad. Errors stay until dismissed and use `role="alert"`. |
| Push-to-talk | `ptt()` | States: idle, listening (red), thinking, speaking (GP talking) and off. Announced with `role="status"`. |
| Empty and error states | `emptyState()`, `errorState()` | Error includes a monospace detail line for logs. |
| Driver strip | `driverStrip()` | The light name bar (position tab, team bar, name, optional flag such as a tyre), a big italic value toned by timing or delta, an aside time with a caption, and sector ticks. |
| Tower | `tower()` | Head (`LAP 7/58`, `Q2 0:04`), rows with your row inverted to the light name bar, fastest, pit and out states, plus an optional red note and a live lap time. |
| Radio card | `radioCard()`, `animateWaveform()` | Speaker plus tag, a waveform strip and quoted lines. GP's lines are in the accent colour and yours are muted. Feed `animateWaveform` from an `AnalyserNode` on GP's audio. |
| Banner | `banner()` | Kinds: fastest (purple), warn (safety car), accent (box box) and info (PB). The tag has a slanted cut. |
| Ghost number | `ghostNumber()` | A big faded team-coloured number behind a card, for Review headers. |
| Input cluster | `inputs()` | Speed with throttle and brake bars. Off by default on the overlay. |
| Overlay panel and callout | `.gp-overlay-panel`, `callout()`, `OverlayFader` | Plain panel for a single spoken line or readout. Fade cycle: in, then dim, then out. |

## Overlay rules (while driving)

- **Corners only.** Nothing goes in the middle of the screen, and nothing duplicates the game's
  HUD (speed, gear, full order, mini-map).
- **Fixed positions.**
  - Tower top-left, showing only the cars directly ahead of and behind you.
  - Radio card on the right edge.
  - Lap strip bottom-left.
  - Event banners bottom-right.
- **The radio card follows speech.** It appears when GP or you start talking and holds for
  `overlay.radioLingerMs` (4s) after speech ends, then fades. A new event replaces the old line
  instead of stacking under it, which matches the voice rule that new events cut off stale speech.
- **Panels fade on their own.** A panel fades in over 120ms, holds for `overlay.holdMs` (6s),
  dims to 0.55, then fades out over 600ms. With nothing to say, the screen is empty.
- **Banners are rare.** They are for one-off events (fastest lap, PB, box, safety car) and stay
  up for about 4s.
- **Type sizes.** Overlay body text is 18px or larger, calls are 26px, and readouts are 40 to
  64px. Weight is 600 or more. Text gets a shadow, and the panel uses a 0.86 scrim (0.94 when
  reduced transparency is on).

## Accessibility

- **Contrast** is enforced by tests (see Tokens).
- **Focus.** A white 2px ring with a 2px offset (`:focus-visible`) on buttons, tabs, inputs and
  interactive rows. It shows on red buttons too.
- **Reduced motion.** `prefers-reduced-motion`, or `data-gp-motion="reduce"` on the root, cuts
  transitions and animations to 1ms and removes the pulse and waveform motion.
- **Reduced transparency and more contrast.** `prefers-reduced-transparency` makes the overlay
  scrim nearly opaque. `prefers-contrast: more` strengthens borders and muted text.
- **Not colour alone.** Deltas carry arrows and screen-reader text, invalid laps are struck
  through, tyres carry letters, and push-to-talk changes its label as well as its colour.
- **Semantics.** Tabs use ARIA roles. Toasts and push-to-talk use live regions. Tables have
  captions and `scope` headers.

## Using it in the desktop app (next step)

1. Add `"@gp/ui": "workspace:*"` to `apps/desktop`.
2. In `apps/desktop/build.mjs`, copy `packages/ui/dist/gp-ui.css` and `dist/fonts/` next to the
   renderer HTML. Turbo's `^build` already runs `@gp/ui`'s build first.
3. Add `<link rel="stylesheet" href="gp-ui.css">` to the page, put `class="gp-app"` on the body,
   and import the builders from `@gp/ui` in `app.ts` and `chat.ts`. esbuild bundles them. The CSP
   `default-src 'self'` already allows the local fonts.
4. Retire the inline `<style>` blocks screen by screen. The old `--radio: #4fc3f7` blue in
   `chat.html` goes away.
