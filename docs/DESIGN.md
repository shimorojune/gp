# GP design system

Source: `packages/ui` (`@gp/ui`). Living style guide: `pnpm --filter @gp/ui styleguide` builds
`packages/ui/dist/styleguide/index.html` and opens it (macOS). Screenshots: `pnpm --filter @gp/ui screenshot`
(needs Playwright).

Status (2026-11-21): **base minimum only**, not yet applied to the screens. It holds the
foundations (colour, type, space, radius, motion) and one component, the radio card. Anything
else is added when a real screen needs it, not up front.

## Direction

- **Pit wall base.** Near-black surfaces close to the app icon (`#15171c`), white text, one red
  (`#e10600`).
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
| `color` | `bg`, `surface`, `surface-raised`, `border`, `edge`, `text`, `text-muted`, `text-faint`, `accent` (red), `accent-text`, `focus-ring`, `good`/`warn`/`bad`, `timing-overall`/`-personal`/`-slower` |
| `team` | Team colours keyed by F1 23 team id (`--gp-team-0` … `--gp-team-9`). `teamColor(id)` falls back to GP red |
| `font` | `display` (GP Display), `sans` (Inter), `mono`, `stretch` 125%, weights 400/500/600/800 |
| `type` | `caption` 11/14, `body` 13/20, `title` 18/24, `quote` 17/19, `name` 28/26, `number` 60/52 |
| `space` | 4px grid: 1=4 … 8=32 |
| `radius` | `sm` 2px (broadcast cards), `md` 6px (app controls) |
| `motion` | `fast` 140ms, `base` 200ms, `fade-out` 600ms, one ease curve |

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

## Using it in the desktop app (next step)

1. Add `"@gp/ui": "workspace:*"` to `apps/desktop`.
2. In `apps/desktop/build.mjs`, copy `packages/ui/dist/gp-ui.css` and `dist/fonts/` next to the
   renderer HTML. Turbo's `^build` runs `@gp/ui`'s build first.
3. Link `gp-ui.css`, put `class="gp-app"` on the body, import builders from `@gp/ui`.
4. Retire inline `<style>` blocks screen by screen, adding tokens/components only as each screen
   needs them.
