/**
 * Core components as HTML-string builders. They pair with the classes in components.css and
 * escape every text argument. Behaviour (tabs, toasts, overlay fades) lives in behaviors.ts.
 */
import { formatDelta, formatLapTime } from '@gp/shared'
import { type Html, content, cx, esc } from './html.ts'

type Text = string | number | Html

// ---------- Button ----------

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export interface ButtonOptions {
  label: Text
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  id?: string
  pressed?: boolean
  disabled?: boolean
  title?: string
  type?: 'button' | 'submit'
}
export function button(o: ButtonOptions): string {
  const cls = cx(
    'gp-btn',
    o.variant && o.variant !== 'secondary' && `gp-btn--${o.variant}`,
    o.size && o.size !== 'md' && `gp-btn--${o.size}`,
  )
  return `<button type="${o.type ?? 'button'}" class="${cls}"${o.id ? ` id="${esc(o.id)}"` : ''}${
    o.pressed !== undefined ? ` aria-pressed="${o.pressed}"` : ''
  }${o.disabled ? ' disabled' : ''}${o.title ? ` title="${esc(o.title)}"` : ''}>${content(o.label)}</button>`
}

// ---------- Tabs ----------

export interface TabsOptions {
  id: string
  tabs: Array<{ id: string; label: Text }>
  selected: string
  variant?: 'line' | 'segmented'
  label?: string
}
/** Tab list markup. Panels use `tabPanel()`; wire both with `bindTabs()`. */
export function tabs(o: TabsOptions): string {
  const items = o.tabs
    .map((t) => {
      const sel = t.id === o.selected
      return `<button type="button" role="tab" class="gp-tab" id="${esc(o.id)}-tab-${esc(t.id)}" aria-controls="${esc(
        o.id,
      )}-panel-${esc(t.id)}" aria-selected="${sel}" tabindex="${sel ? 0 : -1}" data-tab="${esc(t.id)}">${content(
        t.label,
      )}</button>`
    })
    .join('')
  return `<div class="${cx('gp-tabs', o.variant === 'segmented' && 'gp-tabs--segmented')}" role="tablist" id="${esc(
    o.id,
  )}"${o.label ? ` aria-label="${esc(o.label)}"` : ''}>${items}</div>`
}
export function tabPanel(tabsId: string, tabId: string, body: string, selected: boolean): string {
  return `<div class="gp-tab-panel" role="tabpanel" id="${esc(tabsId)}-panel-${esc(tabId)}" aria-labelledby="${esc(
    tabsId,
  )}-tab-${esc(tabId)}"${selected ? '' : ' hidden'}>${body}</div>`
}

// ---------- Card ----------

export interface CardOptions {
  title?: Text
  actions?: string
  body: string
  raised?: boolean
  flush?: boolean
}
export function card(o: CardOptions): string {
  const head =
    o.title || o.actions
      ? `<div class="gp-card-header">${o.title ? `<h2 class="gp-label" style="margin:0">${content(o.title)}</h2>` : ''}<span class="gp-spacer"></span>${o.actions ?? ''}</div>`
      : ''
  return `<section class="${cx('gp-card', o.raised && 'gp-card--raised', o.flush && 'gp-card--flush')}">${head}${o.body}</section>`
}

// ---------- Stat ----------

export interface StatOptions {
  label: Text
  value: Text
  unit?: string
  sub?: Text
  size?: 'sm' | 'md' | 'lg'
  valueClass?: string
}
export function stat(o: StatOptions): string {
  return `<div class="${cx('gp-stat', o.size && o.size !== 'md' && `gp-stat--${o.size}`)}"><span class="gp-label">${content(
    o.label,
  )}</span><span class="${cx('gp-stat-value', o.valueClass)}">${content(o.value)}${
    o.unit ? `<span class="gp-stat-unit">${esc(o.unit)}</span>` : ''
  }</span>${o.sub !== undefined ? `<span class="gp-stat-sub">${content(o.sub)}</span>` : ''}</div>`
}

// ---------- Timing ----------

/** What a time means, F1 timing-screen style. */
export type TimingKind = 'overall' | 'personal' | 'slower' | 'invalid' | 'none'

export interface LapTimeOptions {
  ms: number | null | undefined
  kind?: TimingKind
  size?: 'sm' | 'md' | 'lg' | 'xl'
  italic?: boolean
}
export function lapTime(o: LapTimeOptions): string {
  const empty = !o.ms || o.ms <= 0
  const kind = empty ? 'empty' : o.kind && o.kind !== 'none' ? o.kind : null
  const label = kind === 'invalid' ? ' (invalid)' : ''
  return `<span class="${cx(
    'gp-laptime',
    kind && `gp-laptime--${kind}`,
    o.size && `gp-laptime--${o.size}`,
    o.italic && 'gp-italic',
  )}">${formatLapTime(o.ms)}${label ? `<span class="gp-sr-only">${label}</span>` : ''}</span>`
}

export interface DeltaOptions {
  ms: number
  /** true: negative is good (lap deltas). false: positive is good (gap to car behind). */
  lowerIsBetter?: boolean
  /** Below this absolute value (ms) the delta reads as even. */
  evenWithinMs?: number
  chip?: boolean
  arrow?: boolean
}
export function deltaKind(
  ms: number,
  lowerIsBetter = true,
  evenWithinMs = 5,
): 'gain' | 'loss' | 'even' {
  if (Math.abs(ms) < evenWithinMs) return 'even'
  return ms < 0 === lowerIsBetter ? 'gain' : 'loss'
}
/** +0.214 / -0.214 with a colour that says whether it's good for you. Arrow is shape, not colour only. */
export function delta(o: DeltaOptions): string {
  const kind = deltaKind(o.ms, o.lowerIsBetter ?? true, o.evenWithinMs ?? 5)
  const arrow = o.arrow === false ? '' : kind === 'gain' ? '▲' : kind === 'loss' ? '▼' : '='
  const word = kind === 'gain' ? 'gaining' : kind === 'loss' ? 'losing' : 'even'
  return `<span class="${cx('gp-delta', `gp-delta--${kind}`, o.chip && 'gp-delta--chip')}">${
    arrow ? `<span class="gp-delta-arrow" aria-hidden="true">${arrow}</span>` : ''
  }${formatDelta(o.ms).replace('-', '−')}<span class="gp-sr-only"> ${word}</span></span>`
}

export interface GapOptions {
  side: 'ahead' | 'behind'
  name: string
  gapMs: number
  /** Change in the gap over the last lap, ms. Negative = gap shrinking. */
  trendMs?: number
  /** Gap that fills the bar completely (ms). */
  rangeMs?: number
}
/** Gap to the car ahead or behind with a closing/opening trend bar. */
export function gap(o: GapOptions): string {
  const t = o.trendMs ?? 0
  // Closing the car ahead is good; the car behind closing on you is bad.
  const closing = t < -20
  const opening = t > 20
  const good = o.side === 'ahead' ? closing : opening
  const bad = o.side === 'ahead' ? opening : closing
  const pct = Math.max(4, Math.min(100, (1 - o.gapMs / (o.rangeMs ?? 3000)) * 100))
  const trendText = closing ? 'closing' : opening ? 'opening' : 'holding'
  return `<div class="${cx('gp-gap', good && 'gp-gap--closing', bad && 'gp-gap--opening')}">
    <span class="gp-gap-side">${o.side === 'ahead' ? 'Ahead' : 'Behind'}</span>
    <span class="gp-gap-name gp-caps">${esc(o.name)}</span>
    <span class="gp-gap-value">${(o.gapMs / 1000).toFixed(3)}</span>
    <div class="gp-gap-trend"><div class="gp-gap-track"><div class="gp-gap-fill" style="width:${pct.toFixed(0)}%"></div></div>
    <span class="gp-gap-side">${trendText}${t ? ` ${formatDelta(t).replace('-', '−')}/lap` : ''}</span></div>
  </div>`
}

export interface SectorInfo {
  kind: TimingKind | 'current'
  ms?: number | null
}
/** Three (or N) sector bars with optional times. */
export function sectors(list: SectorInfo[], opts: { times?: boolean } = {}): string {
  const items = list
    .map((s, i) => {
      const t = opts.times
        ? `<span class="gp-sector-time">${s.ms ? (s.ms / 1000).toFixed(3) : `S${i + 1}`}</span>`
        : ''
      return `<div class="${cx('gp-sector', s.kind !== 'none' && `gp-sector--${s.kind}`)}" title="Sector ${i + 1}: ${
        s.kind
      }"><div class="gp-sector-bar"></div>${t}</div>`
    })
    .join('')
  return `<div class="gp-sectors" style="--_count:${list.length}">${items}</div>`
}

// ---------- Status ----------

export type DotKind = 'good' | 'warn' | 'bad' | 'neutral' | 'live' | 'off'
export function statusDot(kind: DotKind, label?: Text, pulse = false): string {
  const dot = `<span class="${cx('gp-dot', kind !== 'neutral' && `gp-dot--${kind}`, pulse && 'gp-dot--pulse')}"${
    label ? ' aria-hidden="true"' : ` role="img" aria-label="${kind}"`
  }></span>`
  return label ? `<span class="gp-status">${dot}${content(label)}</span>` : dot
}
export function pill(label: Text, dot?: DotKind): string {
  return `<span class="gp-pill">${dot ? statusDot(dot) : ''}${content(label)}</span>`
}

export type TyreCompound = 'soft' | 'medium' | 'hard' | 'inter' | 'wet'
const TYRE_LETTER: Record<TyreCompound, string> = {
  soft: 'S',
  medium: 'M',
  hard: 'H',
  inter: 'I',
  wet: 'W',
}
export function tyre(compound: TyreCompound): string {
  return `<span class="gp-tyre gp-tyre--${compound}" role="img" aria-label="${compound} tyre">${TYRE_LETTER[compound]}</span>`
}

// ---------- Form fields ----------

export interface FieldOptions {
  id: string
  label: string
  kind?: 'input' | 'textarea' | 'select'
  value?: string
  placeholder?: string
  hint?: string
  error?: string
  options?: string[]
}
export function field(o: FieldOptions): string {
  const describedBy = o.error ? `${o.id}-error` : o.hint ? `${o.id}-hint` : ''
  const attrs = `id="${esc(o.id)}" class="gp-input"${o.placeholder ? ` placeholder="${esc(o.placeholder)}"` : ''}${
    describedBy ? ` aria-describedby="${esc(describedBy)}"` : ''
  }${o.error ? ' aria-invalid="true"' : ''}`
  const control =
    o.kind === 'textarea'
      ? `<textarea ${attrs}>${esc(o.value ?? '')}</textarea>`
      : o.kind === 'select'
        ? `<select ${attrs}>${(o.options ?? [])
            .map((v) => `<option${v === o.value ? ' selected' : ''}>${esc(v)}</option>`)
            .join('')}</select>`
        : `<input ${attrs} value="${esc(o.value ?? '')}" />`
  return `<div class="gp-field"><label class="gp-field-label" for="${esc(o.id)}">${esc(o.label)}</label>${control}${
    o.error
      ? `<span class="gp-field-error" id="${esc(o.id)}-error">${esc(o.error)}</span>`
      : o.hint
        ? `<span class="gp-field-hint" id="${esc(o.id)}-hint">${esc(o.hint)}</span>`
        : ''
  }</div>`
}

// ---------- List and table ----------

export interface ListItem {
  title: Text
  meta?: Text
  leading?: string
  trailing?: string
  current?: boolean
}
export function list(items: ListItem[], interactive = false): string {
  return `<ul class="${cx('gp-list', interactive && 'gp-list--interactive')}">${items
    .map(
      (it) =>
        `<li class="gp-list-item"${interactive ? ' tabindex="0"' : ''}${it.current ? ' aria-current="true"' : ''}>${
          it.leading ?? ''
        }<div class="gp-list-main"><div class="gp-list-title">${content(it.title)}</div>${
          it.meta !== undefined ? `<div class="gp-list-meta">${content(it.meta)}</div>` : ''
        }</div>${it.trailing ?? ''}</li>`,
    )
    .join('')}</ul>`
}

export interface Column<Row> {
  label: string
  cell: (row: Row) => Text
  numeric?: boolean
}
export function table<Row>(
  columns: Column<Row>[],
  rows: Row[],
  opts: { isMe?: (row: Row) => boolean; compact?: boolean; caption?: string } = {},
): string {
  const head = columns
    .map((c) => `<th scope="col"${c.numeric ? ' class="gp-num-col"' : ''}>${esc(c.label)}</th>`)
    .join('')
  const body = rows
    .map(
      (r) =>
        `<tr${opts.isMe?.(r) ? ' class="gp-row--me"' : ''}>${columns
          .map((c) => `<td${c.numeric ? ' class="gp-num-col"' : ''}>${content(c.cell(r))}</td>`)
          .join('')}</tr>`,
    )
    .join('')
  return `<table class="${cx('gp-table', opts.compact && 'gp-table--compact')}">${
    opts.caption ? `<caption class="gp-sr-only">${esc(opts.caption)}</caption>` : ''
  }<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
}

// ---------- Push-to-talk ----------

export type PttState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'off'
const PTT_LABEL: Record<PttState, string> = {
  idle: 'Hold L3 to talk',
  listening: 'Listening',
  thinking: 'GP is thinking',
  speaking: 'GP on the radio',
  off: 'Mic unavailable',
}
export function ptt(state: PttState, label = PTT_LABEL[state]): string {
  return `<span class="gp-ptt" data-state="${state}" role="status" aria-live="polite"><span class="gp-ptt-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>${esc(
    label,
  )}</span>`
}

// ---------- Empty and error states ----------

const ICON_EMPTY =
  '<svg class="gp-state-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 22c4-8 8-12 12-12s8 4 12 12"/><path d="M4 26h24" stroke-dasharray="3 3"/></svg>'
const ICON_ERROR =
  '<svg class="gp-state-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M16 4 29 27H3L16 4Z"/><path d="M16 13v6M16 23v.5" stroke-linecap="round"/></svg>'

export interface StateOptions {
  title: Text
  body?: Text
  actions?: string
  detail?: string
}
export function emptyState(o: StateOptions): string {
  return `<div class="gp-state">${ICON_EMPTY}<div class="gp-state-title">${content(o.title)}</div>${
    o.body !== undefined ? `<div class="gp-state-body">${content(o.body)}</div>` : ''
  }${o.actions ? `<div class="gp-btn-row">${o.actions}</div>` : ''}</div>`
}
export function errorState(o: StateOptions): string {
  return `<div class="gp-state gp-state--error" role="alert">${ICON_ERROR}<div class="gp-state-title">${content(
    o.title,
  )}</div>${o.body !== undefined ? `<div class="gp-state-body">${content(o.body)}</div>` : ''}${
    o.detail ? `<div class="gp-state-detail">${esc(o.detail)}</div>` : ''
  }${o.actions ? `<div class="gp-btn-row">${o.actions}</div>` : ''}</div>`
}
