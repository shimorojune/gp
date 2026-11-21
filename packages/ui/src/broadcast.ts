/**
 * Broadcast-inspired components (driver strip, tower, radio card, banners, overlay callout).
 * Pair with broadcast.css. Team colours are passed as data via the --gp-team custom property.
 */
import { formatLapTime } from '@gp/shared'
import type { TimingKind } from './components.ts'
import { type Html, content, cx, esc } from './html.ts'
import { teamColor } from './tokens.ts'

type Text = string | number | Html

const teamStyle = (teamId?: number | null) => `--gp-team:${teamColor(teamId)}`

export function teamBar(teamId?: number | null): string {
  return `<span class="gp-teambar" style="${teamStyle(teamId)}" aria-hidden="true"></span>`
}

export function positionTab(
  pos: number | string,
  opts: { light?: boolean; moved?: 'up' | 'down' } = {},
): string {
  return `<span class="${cx(
    'gp-postab',
    opts.light && 'gp-postab--light',
    opts.moved && `gp-postab--${opts.moved}`,
  )}" aria-label="P${esc(pos)}${opts.moved ? `, ${opts.moved}` : ''}">${esc(pos)}</span>`
}

/** Sector ticks for the bottom of a strip. */
export function ticks(list: Array<TimingKind | 'current'>, labels?: string[]): string {
  return `<div class="gp-ticks" style="--_count:${list.length}">${list
    .map(
      (k, i) =>
        `<span class="${cx('gp-tick', k !== 'none' && `gp-tick--${k}`)}">${esc(labels?.[i] ?? `S${i + 1}`)}</span>`,
    )
    .join('')}</div>`
}

export type StripTone = TimingKind | 'gain' | 'loss' | 'plain'
export interface DriverStripOptions {
  position: number | string
  name: string
  teamId?: number | null
  /** The big number: a gap, delta or lap time, already formatted. */
  value: Text
  tone?: StripTone
  /** Smaller secondary time on the right, e.g. the reference lap. */
  asideValue?: Text
  /** Caption under it, e.g. the reference driver. */
  asideLabel?: Text
  /** Short right-aligned flag in the name bar (e.g. tyre letter, "PIT"). */
  flag?: Text
  sectors?: Array<TimingKind | 'current'>
  sectorLabels?: string[]
}
/** Light name bar on top, dark body with a big value, sector ticks underneath. */
export function driverStrip(o: DriverStripOptions): string {
  const tone = o.tone && o.tone !== 'plain' && o.tone !== 'none' ? `gp-strip-value--${o.tone}` : ''
  return `<div class="gp-strip">
    <div class="gp-strip-head">${positionTab(o.position)}${teamBar(o.teamId)}<span class="gp-strip-name">${esc(
      o.name,
    )}</span>${o.flag !== undefined ? `<span class="gp-strip-flag">${content(o.flag)}</span>` : ''}</div>
    <div class="gp-strip-body"><span class="${cx('gp-strip-value', tone)}">${content(o.value)}</span>${
      o.asideValue !== undefined
        ? `<span class="gp-strip-aside"><b>${content(o.asideValue)}</b>${
            o.asideLabel !== undefined ? `<span>${content(o.asideLabel)}</span>` : ''
          }</span>`
        : ''
    }</div>
    ${o.sectors ? ticks(o.sectors, o.sectorLabels) : ''}
  </div>`
}

export interface TowerRow {
  position: number
  code: string
  teamId?: number | null
  /** "LEADER", "+1.204", "PIT", "1 LAP" ... */
  gap: Text
  me?: boolean
  fastest?: boolean
  pit?: boolean
  out?: boolean
  moved?: 'up' | 'down'
}
export interface TowerOptions {
  /** e.g. ['LAP', '7/58'] or ['Q2', '0:04'] */
  head?: [string, string]
  rows: TowerRow[]
  /** Red caption under the rows, e.g. "Danger zone". */
  note?: string
  /** Live lap time under the note. */
  liveMs?: number | null
}
/** Compact timing tower. On the overlay show only the cars around you (see DESIGN.md). */
export function tower(o: TowerOptions): string {
  const head = o.head
    ? `<div class="gp-tower-head">${esc(o.head[0])} <b>${esc(o.head[1])}</b></div>`
    : ''
  const rows = o.rows
    .map(
      (r) =>
        `<div class="${cx(
          'gp-tower-row',
          r.me && 'gp-tower-row--me',
          r.fastest && 'gp-tower-row--fastest',
          r.pit && 'gp-tower-row--pit',
          r.out && 'gp-tower-row--out',
        )}"${r.me ? ' aria-current="true"' : ''}><span class="gp-tower-pos">${esc(r.position)}</span>${teamBar(
          r.teamId,
        )}<span class="gp-tower-code">${esc(r.code)}</span><span class="gp-tower-gap">${content(r.gap)}</span></div>`,
    )
    .join('')
  const note = o.note ? `<div class="gp-tower-note">${esc(o.note)}</div>` : ''
  const live =
    o.liveMs !== undefined ? `<div class="gp-tower-live">${formatLapTime(o.liveMs)}</div>` : ''
  return `<div class="gp-tower" role="table" aria-label="Running order">${head}${rows}${note}${live}</div>`
}

export interface RadioLine {
  who: 'gp' | 'driver'
  text: string
}
export interface RadioCardOptions {
  /** Who is speaking now; shown big in the header. */
  speaker: string
  tag?: string
  lines: RadioLine[]
  speaking?: boolean
  /** Number of waveform bars. */
  bars?: number
  state?: 'in' | 'out'
}
/**
 * Radio card: speaker, a waveform strip, then the quoted lines. GP's lines take the accent
 * colour, the driver's are muted. Drive the waveform with `animateWaveform()`.
 */
export function radioCard(o: RadioCardOptions): string {
  const n = o.bars ?? 36
  const bars = Array.from({ length: n }, () => '<i></i>').join('')
  const lines = o.lines
    .map((l) => `<p class="gp-radio-line gp-radio-line--${l.who}">${esc(l.text)}</p>`)
    .join('')
  return `<div class="gp-radio" data-state="${o.state ?? 'in'}" data-speaking="${o.speaking ?? true}" role="log" aria-live="polite">
    <div class="gp-radio-head"><span class="gp-radio-who">${esc(o.speaker)}</span><span class="gp-radio-tag">${esc(
      o.tag ?? 'Radio',
    )}</span></div>
    <div class="gp-radio-wave" aria-hidden="true">${bars}</div>
    <div class="gp-radio-lines">${lines}</div>
  </div>`
}

export type BannerKind = 'fastest' | 'warn' | 'info' | 'accent'
export function banner(kind: BannerKind, tag: string, main: Text): string {
  return `<div class="${cx('gp-banner', kind !== 'accent' && `gp-banner--${kind}`)}" role="status"><span class="gp-banner-tag">${esc(
    tag,
  )}</span><span class="gp-banner-main">${content(main)}</span></div>`
}

/** Card with a big faded team-coloured number behind it. */
export function ghostNumber(
  num: number | string,
  teamId: number | null | undefined,
  body: string,
): string {
  return `<div class="gp-ghostnum" data-num="${esc(num)}" style="${teamStyle(teamId)}">${body}</div>`
}

/** Optional overlay input cluster. Off by default: the game already shows this. */
export function inputs(o: { speedKph: number; throttle: number; brake: number }): string {
  const v = (x: number) => Math.max(0, Math.min(1, x)).toFixed(2)
  return `<div class="gp-inputs" aria-label="Speed ${o.speedKph} km/h"><div class="gp-inputs-bar gp-inputs-bar--brake" style="--v:${v(
    o.brake,
  )}"></div><div class="gp-inputs-speed"><b>${Math.round(o.speedKph)}</b><span>KM/H</span></div><div class="gp-inputs-bar gp-inputs-bar--throttle" style="--v:${v(
    o.throttle,
  )}"></div></div>`
}

/** The one-line spoken call, big, on the overlay panel. */
export function callout(
  text: string,
  tone: 'accent' | 'info' | 'good' | 'warn' = 'accent',
): string {
  return `<div class="${cx('gp-callout', tone !== 'accent' && `gp-callout--${tone}`)}"><div class="gp-callout-text">${esc(
    text,
  )}</div></div>`
}
