import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrast, contrastOf, over } from '../src/contrast.ts'
import { tokenEntries } from '../src/css-vars.ts'
import { color, overlay, palette } from '../src/tokens.ts'

const AA = 4.5
const AA_LARGE = 3

describe('text contrast on app surfaces (WCAG AA)', () => {
  const surfaces = {
    bg: color.bg,
    surface: color.surface,
    raised: color.surfaceRaised,
    sunken: color.surfaceSunken,
  }
  const body = {
    text: color.text,
    textMuted: color.textMuted,
    accentText: color.accentText,
    good: color.good,
    warn: color.warn,
    bad: color.bad,
  }
  const timing = {
    overall: color.timingOverall,
    personal: color.timingPersonal,
    slower: color.timingSlower,
    invalid: color.timingInvalid,
  }
  for (const [sName, s] of Object.entries(surfaces)) {
    for (const [tName, t] of Object.entries({ ...body, ...timing })) {
      it(`${tName} on ${sName} >= 4.5`, () => expect(contrastOf(t, s)).toBeGreaterThanOrEqual(AA))
    }
    it(`textFaint on ${sName} >= 3 (hints and placeholders only)`, () =>
      expect(contrastOf(color.textFaint, s)).toBeGreaterThanOrEqual(AA_LARGE))
  }
  it('white on the accent button >= 4.5', () =>
    expect(contrastOf(color.textOnAccent, color.accent)).toBeGreaterThanOrEqual(AA))
  it('name bar text on name bar >= 7', () =>
    expect(contrastOf(color.nameBarText, color.nameBar)).toBeGreaterThanOrEqual(7))
  it('focus ring vs surfaces >= 3 (non-text)', () => {
    for (const s of [color.bg, color.surface, color.surfaceRaised])
      expect(contrastOf(color.focusRing, s)).toBeGreaterThanOrEqual(3)
  })
})

describe('overlay readability over the game', () => {
  // Worst case is a white sky or a white wall behind the panel.
  const worst: Array<[string, [number, number, number]]> = [
    ['white', [255, 255, 255]],
    ['bright grey', [200, 200, 200]],
    ['red car', [225, 6, 0]],
  ]
  for (const [name, bg] of worst) {
    const panel = over(overlay.scrim, bg)
    it(`overlay text on scrim over ${name} >= 7`, () =>
      expect(contrast(over(overlay.text, panel), panel)).toBeGreaterThanOrEqual(7))
    it(`overlay muted text on scrim over ${name} >= 4.5`, () =>
      expect(contrast(over(overlay.textMuted, panel), panel)).toBeGreaterThanOrEqual(AA))
    it(`GP accent line on scrim over ${name} >= 4.5`, () =>
      expect(contrast(over(overlay.accentText, panel), panel)).toBeGreaterThanOrEqual(AA))
  }
})

describe('palette rules', () => {
  it('uses the icon background and F1 red', () => {
    expect(palette.graphite[100]).toBe('#15171c')
    expect(color.accent).toBe('#e10600')
  })
  it('no blue/teal/cyan in UI colour roles (data colours excepted)', () => {
    const dataOnly = new Set(['tyreWet'])
    for (const [k, v] of Object.entries(color)) {
      if (dataOnly.has(k) || !v.startsWith('#')) continue
      const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(v.slice(i, i + 2), 16)) as [
        number,
        number,
        number,
      ]
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      if (max - min < 40) continue // greys
      const d = max - min
      const hue =
        max === r
          ? (60 * ((g - b) / d) + 360) % 360
          : max === g
            ? 60 * ((b - r) / d) + 120
            : 60 * ((r - g) / d) + 240
      const bluish = hue >= 170 && hue <= 250
      expect(bluish, `${k} ${v} reads as blue`).toBe(false)
    }
  })
})

describe('generated CSS', () => {
  const css = [
    readFileSync(new URL('../src/components.css', import.meta.url), 'utf8'),
    readFileSync(new URL('../src/broadcast.css', import.meta.url), 'utf8'),
  ].join('\n')
  const defined = new Set(tokenEntries().map(([k]) => k))
  it('components only reference defined --gp-* tokens', () => {
    const used = new Set([...css.matchAll(/var\((--gp-[a-z0-9-]+)/g)].map((m) => m[1]!))
    const missing = [...used].filter((u) => !defined.has(u) && u !== '--gp-team')
    expect(missing).toEqual([])
  })
  it('components never hard-code hex colours', () => {
    expect(css.match(/#[0-9a-f]{3,6}\b/gi) ?? []).toEqual([])
  })
})
