import { describe, expect, it } from 'vitest'
import { driverStrip, radioCard, tower } from '../src/broadcast.ts'
import { button, delta, deltaKind, gap, lapTime, sectors, table } from '../src/components.ts'
import { raw } from '../src/html.ts'

describe('components', () => {
  it('escapes text', () => {
    expect(button({ label: '<b>x</b>' })).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(button({ label: raw('<b>x</b>') })).toContain('<b>x</b>')
    expect(driverStrip({ position: 1, name: '<script>', value: '1:00.000' })).not.toContain(
      '<script>',
    )
  })
  it('lap time kinds', () => {
    expect(lapTime({ ms: 72034, kind: 'overall' })).toContain('gp-laptime--overall')
    expect(lapTime({ ms: 72034 })).toContain('1:12.034')
    expect(lapTime({ ms: 0 })).toContain('gp-laptime--empty')
    expect(lapTime({ ms: 72034, kind: 'invalid' })).toContain('(invalid)')
  })
  it('delta direction', () => {
    expect(deltaKind(-214)).toBe('gain')
    expect(deltaKind(214)).toBe('loss')
    expect(deltaKind(2)).toBe('even')
    expect(deltaKind(500, false)).toBe('gain')
    expect(delta({ ms: -214 })).toContain('−0.214')
    expect(delta({ ms: -214 })).toContain('gaining')
  })
  it('gap trend: closing the car ahead is good, the car behind closing is bad', () => {
    expect(gap({ side: 'ahead', name: 'LEC', gapMs: 800, trendMs: -150 })).toContain(
      'gp-gap--closing',
    )
    expect(gap({ side: 'behind', name: 'VER', gapMs: 800, trendMs: -150 })).toContain(
      'gp-gap--opening',
    )
  })
  it('sectors and table', () => {
    expect(sectors([{ kind: 'overall' }, { kind: 'personal' }, { kind: 'none' }])).toContain(
      '--_count:3',
    )
    const t = table(
      [{ label: 'Lap', cell: (r: { n: number }) => r.n, numeric: true }],
      [{ n: 1 }, { n: 2 }],
      { isMe: (r) => r.n === 2 },
    )
    expect(t).toContain('gp-row--me')
  })
  it('tower marks you and radio card renders lines', () => {
    expect(tower({ rows: [{ position: 3, code: 'YOU', gap: '+3.9', me: true }] })).toContain(
      'gp-tower-row--me',
    )
    const r = radioCard({ speaker: 'GP', lines: [{ who: 'gp', text: 'Box this lap.' }], bars: 4 })
    expect(r).toContain('gp-radio-line--gp')
    expect(r.match(/<i><\/i>/g)).toHaveLength(4)
  })
})
