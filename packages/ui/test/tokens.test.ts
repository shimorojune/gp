import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrastOf } from '../src/contrast.ts'
import { tokenEntries } from '../src/css-vars.ts'
import { radioCard } from '../src/radio.ts'
import { color, teamColor, teamColors } from '../src/tokens.ts'

const AA = 4.5

describe('contrast', () => {
  for (const s of ['bg', 'surface', 'surfaceRaised'] as const) {
    for (const t of [
      'text',
      'textMuted',
      'accentText',
      'good',
      'warn',
      'bad',
      'timingOverall',
      'timingPersonal',
      'timingSlower',
    ] as const) {
      it(`${t} on ${s} >= 4.5`, () =>
        expect(contrastOf(color[t], color[s])).toBeGreaterThanOrEqual(AA))
    }
  }
  it('every team colour is readable as large text on the radio card (>= 3)', () => {
    for (const c of Object.values(teamColors))
      expect(contrastOf(c, color.surface)).toBeGreaterThanOrEqual(3)
  })
})

describe('palette rules', () => {
  it('keeps the icon red', () => expect(color.accent).toBe('#e10600'))
  it('no blue, teal or cyan in UI roles (team colours are data)', () => {
    for (const [k, v] of Object.entries(color)) {
      if (!v.startsWith('#')) continue
      const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(v.slice(i, i + 2), 16)) as [
        number,
        number,
        number,
      ]
      const max = Math.max(r, g, b)
      const d = max - Math.min(r, g, b)
      if (d < 40) continue
      const hue =
        max === r
          ? (60 * ((g - b) / d) + 360) % 360
          : max === g
            ? 60 * ((b - r) / d) + 120
            : 60 * ((r - g) / d) + 240
      expect(hue >= 170 && hue <= 250, `${k} ${v} reads as blue`).toBe(false)
    }
  })
  it('unknown team falls back to GP red', () => expect(teamColor(42)).toBe(color.accent))
})

describe('CSS', () => {
  const css = ['base.css', 'radio.css']
    .map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'))
    .join('\n')
  const defined = new Set(tokenEntries().map(([k]) => k))
  it('only references defined --gp-* tokens', () => {
    const used = [...css.matchAll(/var\((--gp-[a-z0-9-]+)/g)].map((m) => m[1]!)
    expect(used.filter((u) => !defined.has(u) && u !== '--gp-team')).toEqual([])
  })
  it('no hard-coded colours (mask stops excepted)', () => {
    expect((css.match(/#[0-9a-f]{3,6}\b/gi) ?? []).filter((h) => h !== '#000')).toEqual([])
  })
})

describe('radio card', () => {
  it('escapes, colours by team, splits GP and driver lines', () => {
    const html = radioCard({
      driver: '<b>',
      number: 4,
      teamId: 8,
      lines: [
        { who: 'gp', text: 'Box' },
        { who: 'driver', text: 'Copy' },
      ],
    })
    expect(html).toContain('&lt;b&gt;')
    expect(html).toContain('--gp-team:#ff8000')
    expect(html).toContain('gp-radio-line--gp')
    expect(html).toContain('gp-radio-line--driver')
  })
})
