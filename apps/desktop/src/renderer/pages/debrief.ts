import { formatLapTime } from '@gp/shared'
import { teamColorByName } from '@gp/ui'
import type { CareersInfo, Program, SessionDetail, SessionListItem } from '../../ipc.ts'
import { $, esc, mark, setHtml } from '../dom.ts'
import { get, gp, watch } from '../store.ts'

/*
 * Debrief: the library of every filed session (career / time trial / sim) on the left, and the
 * selected session, weekend or car on the right. Everything here is read from the history DB
 * through sessions() and sessionDetail(); nothing is invented when a field is missing.
 */

type Sel =
  | { kind: 'session'; uid: string }
  | { kind: 'weekend'; link: number }
  | { kind: 'car'; car: string }

interface Item {
  sel: Sel
  title: string
  meta: string
  end: string
  team: string
  status: string
}
interface Group {
  label: string
  items: Item[]
}

const PROGRAMS: [Program, string][] = [
  ['career', 'Career'],
  ['time_trial', 'Time trial'],
  ['sim', 'Sim'],
]
const FAINT = '#66666d'
const SETUP_LABELS: Record<string, string> = {
  frontWing: 'front wing',
  rearWing: 'rear wing',
  onThrottle: 'diff on throttle',
  offThrottle: 'diff off throttle',
  frontCamber: 'front camber',
  rearCamber: 'rear camber',
  frontToe: 'front toe',
  rearToe: 'rear toe',
  frontSuspension: 'front suspension',
  rearSuspension: 'rear suspension',
  frontAntiRollBar: 'front anti-roll bar',
  rearAntiRollBar: 'rear anti-roll bar',
  frontSuspensionHeight: 'front ride height',
  rearSuspensionHeight: 'rear ride height',
  brakePressure: 'brake pressure',
  brakeBias: 'brake bias',
  rearLeftTyrePressure: 'RL tyre psi',
  rearRightTyrePressure: 'RR tyre psi',
  frontLeftTyrePressure: 'FL tyre psi',
  frontRightTyrePressure: 'FR tyre psi',
  ballast: 'ballast',
}
const INCIDENT: Record<string, string> = {
  penalty: 'Penalty',
  warning: 'Warning',
  flashback: 'Flashback',
  damage: 'Damage',
  retired: 'Retired',
  lost_places: 'Lost places',
}

// ------------------------------------------------------------------ formatting

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const longWhen = (iso: string) => {
  const d = new Date(iso)
  return `${day(iso)}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}
/** −0.409 / +0.292 with a real minus sign. */
const delta = (ms: number) => `${ms < 0 ? '−' : '+'}${(Math.abs(ms) / 1000).toFixed(3)}`
const secs = (ms: number | null) => (ms == null ? '–' : (ms / 1000).toFixed(3))
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const kindOf = (s: SessionListItem) => {
  const t = s.sessionType.toLowerCase()
  if (s.program === 'time_trial' || t.includes('time trial')) return 'tt'
  if (t.includes('race')) return 'race'
  if (t.includes('qual') || t.includes('one-shot') || t.includes('short q')) return 'quali'
  return 'practice'
}
const result = (s: SessionListItem) =>
  s.status === 'restarted' || (s.status === 'abandoned' && !s.finishPos)
    ? '–'
    : s.finishPos && kindOf(s) !== 'tt'
      ? `P${s.finishPos}`
      : formatLapTime(s.bestLapMs).replace('--:--.---', '–')
const teamOf = (s: SessionListItem) =>
  s.status === 'finished' ? teamColorByName(s.car ?? s.team) : FAINT
const filing = (s: SessionListItem) =>
  s.program === 'career'
    ? s.career
      ? `${s.career.name}${s.career.season ? ` · Season ${s.career.season}` : ''}`
      : 'Career · season not filed'
    : s.program === 'time_trial'
      ? `Time trial${s.car ? ` · ${s.car}` : ''}`
      : `Sim · ${s.mode}`
const same = (a: Sel | null, b: Sel) =>
  !!a &&
  a.kind === b.kind &&
  (a.kind === 'session'
    ? a.uid === (b as { uid: string }).uid
    : a.kind === 'weekend'
      ? a.link === (b as { link: number }).link
      : a.car === (b as { car: string }).car)

// ------------------------------------------------------------------ library

function sessionItem(s: SessionListItem, inGroupMeta?: string): Item {
  const restarted = s.status === 'restarted'
  return {
    sel: { kind: 'session', uid: s.uid },
    title: `${s.track} · ${s.sessionType}${restarted ? ', restarted' : ''}`,
    meta: restarted
      ? `Restarted after ${plural(s.lapsDone, 'lap')}, out of stats`
      : [
          inGroupMeta,
          day(s.startedAt),
          s.status === 'abandoned' ? 'abandoned' : '',
          s.pendingSync ? 'not synced yet' : '',
        ]
          .filter(Boolean)
          .join(' · '),
    end: result(s),
    team: teamOf(s),
    status: s.status,
  }
}

function careerGroups(list: SessionListItem[]): Group[] {
  const groups = new Map<string, { label: string; sessions: SessionListItem[] }>()
  for (const s of list) {
    const key = s.career ? `${s.career.id}:${s.career.season ?? s.seasonLink}` : `u:${s.seasonLink}`
    if (!groups.has(key)) {
      const label = s.career
        ? [s.career.name, s.team, s.career.season ? `Season ${s.career.season}` : null]
        : ['Not filed yet', s.team]
      groups.set(key, { label: label.filter(Boolean).join(' · '), sessions: [] })
    }
    groups.get(key)!.sessions.push(s)
  }
  return [...groups.values()].map((g) => {
    const items: Item[] = []
    const done = new Set<number>()
    for (const s of g.sessions) {
      const link = s.weekendLink
      if (link != null && !done.has(link)) {
        done.add(link)
        const wk = g.sessions.filter((x) => x.weekendLink === link)
        if (wk.length > 1) {
          const race = wk.find((x) => kindOf(x) === 'race' && x.status === 'finished')
          const first = wk[wk.length - 1]!
          const last = wk[0]!
          const span =
            day(first.startedAt) === day(last.startedAt)
              ? day(last.startedAt)
              : `${day(first.startedAt)} – ${day(last.startedAt)}`
          items.push({
            sel: { kind: 'weekend', link },
            title: `${s.track} · Weekend`,
            meta: `${span} · ${plural(wk.filter((x) => x.status === 'finished').length, 'session')}`,
            end: race?.finishPos ? `P${race.finishPos}` : '',
            team: teamColorByName(s.car ?? s.team),
            status: 'finished',
          })
        }
      }
      items.push(sessionItem(s))
    }
    return { label: g.label, items }
  })
}

function ttGroups(list: SessionListItem[]): Group[] {
  const cars = new Map<string, SessionListItem[]>()
  for (const s of list) {
    const car = s.car ?? s.team ?? 'Unknown car'
    if (!cars.has(car)) cars.set(car, [])
    cars.get(car)!.push(s)
  }
  return [...cars].map(([car, ss]) => {
    const tracks = new Set(ss.map((s) => s.trackId)).size
    const laps = ss.reduce((a, s) => a + s.lapsDone, 0)
    return {
      label: car,
      items: [
        {
          sel: { kind: 'car', car },
          title: 'Car profile',
          meta: `${plural(tracks, 'track')} · ${plural(laps, 'lap')}`,
          end: '',
          team: teamColorByName(car),
          status: 'finished',
        },
        ...ss.map((s) => ({ ...sessionItem(s), title: s.track })),
      ],
    }
  })
}

function simGroups(list: SessionListItem[], gpOnly: boolean): Group[] {
  const ss = gpOnly ? list.filter((s) => s.mode.toLowerCase().includes('grand prix')) : list
  return ss.length
    ? [
        {
          label: gpOnly ? 'Grand Prix mode' : 'Newest first',
          items: ss.map((s) => sessionItem(s, s.mode)),
        },
      ]
    : []
}

// ------------------------------------------------------------------ detail pieces

const gpHead = (title: string) =>
  `<div class="panel-head"><span class="gp-msg-avatar" style="width: 24px; height: 24px">${mark(10)}</span><h2 class="h">${esc(title)}</h2></div>`

interface Hero {
  label: string
  big?: string
  val?: string
  cap?: string
  valCls?: string
  capCls?: string
}
const hero = (hs: Hero[]) =>
  `<div class="hero" style="margin-bottom: 0">${hs
    .map(
      (h, i) =>
        `<div class="gp-enter${h.big && h.big.length > 4 ? ' is-wide' : ''}" style="--i: ${i}"><span class="gp-stat-label">${esc(h.label)}</span>${
          h.big != null
            ? `<div class="big">${esc(h.big)}</div>`
            : `<div class="val ${h.valCls ?? ''}">${esc(h.val ?? '–')}</div>`
        }<span class="cap ${h.capCls ?? ''}">${esc(h.cap ?? '')}</span></div>`,
    )
    .join('')}</div>`

const table = (
  cols: string,
  head: string[] | null,
  rows: { v: string; cls?: string }[][],
  pick?: string[],
) =>
  `<div class="tbl" style="--cols: ${cols}">${
    head ? `<div class="tr th">${head.map((h) => `<span>${esc(h)}</span>`).join('')}</div>` : ''
  }${rows
    .map(
      (r, i) =>
        `<div class="tr${pick?.[i] ? ' is-link' : ''}" style="--i: ${i}"${pick?.[i] ? ` data-pick="${esc(pick[i]!)}" role="button" tabindex="0"` : ''}>${r
          .map((c) => `<span class="${c.cls ?? ''}">${esc(c.v)}</span>`)
          .join('')}</div>`,
    )
    .join('')}</div>`

const countedLaps = (d: SessionDetail) =>
  d.laps.filter((l) => l.valid && !l.flashback && l.lapMs > 0)

function bestLap(d: SessionDetail) {
  const ok = countedLaps(d)
  return ok.length ? ok.reduce((a, l) => (l.lapMs < a.lapMs ? l : a)) : null
}

/** Against his best here in this car before this session (any program). */
function pbHero(d: SessionDetail, best: number | null): Hero | null {
  if (!best) return null
  if (d.pbMs == null)
    return { label: 'vs your PB', val: 'First time', cap: `here in the ${d.car ?? 'car'}` }
  const dt = best - d.pbMs
  return dt < 0
    ? { label: 'vs your PB', val: delta(dt), valCls: 'pb', cap: 'New PB here', capCls: 'pb' }
    : { label: 'vs your PB', val: delta(dt), cap: `PB ${formatLapTime(d.pbMs)}` }
}

function sessionHero(d: SessionDetail): Hero[] {
  const best = bestLap(d)
  const k = kindOf(d)
  const out: Hero[] = []
  const bestCap = best ? `lap ${best.lap}` : 'no valid lap'
  if (d.status === 'restarted') {
    return [
      { label: 'Laps', val: String(d.lapsDone), cap: 'then restarted' },
      { label: 'Best lap', val: best ? formatLapTime(best.lapMs) : '–', cap: 'not counted' },
    ]
  }
  if (k === 'tt') {
    const pb = pbHero(d, best?.lapMs ?? null)
    const newPb = pb?.capCls === 'pb'
    out.push({
      label: 'Best',
      big: best ? formatLapTime(best.lapMs) : '–',
      cap: newPb ? `New PB, ${pb.val}` : bestCap,
      capCls: newPb ? 'pb' : '',
    })
    if (pb && !newPb) out.push(pb)
    if (d.idealLapMs)
      out.push({
        label: 'Theoretical',
        val: formatLapTime(d.idealLapMs),
        cap: 'best sectors combined',
      })
    if (d.consistencyMs != null)
      out.push({
        label: 'Consistency',
        val: `±${(d.consistencyMs / 1000).toFixed(2)}`,
        cap: 'valid laps',
      })
    out.push({ label: 'Laps', val: String(d.validLaps), cap: `valid of ${d.lapsDone}` })
    return out
  }
  if (d.status === 'abandoned' && !d.finishPos) {
    out.push({ label: 'Result', big: '–', cap: `Left after ${plural(d.lapsDone, 'lap')}` })
    out.push({
      label: 'Best lap',
      val: best ? formatLapTime(best.lapMs) : '–',
      cap: 'counts for pace only',
    })
    return out
  }
  const label = k === 'race' ? 'Result' : k === 'quali' ? 'Grid' : 'Position'
  const gained = d.gridPos && d.finishPos ? d.gridPos - d.finishPos : 0
  out.push({
    label,
    big: d.finishPos ? `P${d.finishPos}` : '–',
    cap:
      k === 'race' && d.gridPos
        ? `from P${d.gridPos} on the grid`
        : d.numCars
          ? `of ${d.numCars}`
          : '',
    capCls: k === 'race' && gained > 0 ? 'up' : '',
  })
  out.push({ label: 'Best lap', val: best ? formatLapTime(best.lapMs) : '–', cap: bestCap })
  const pb = pbHero(d, best?.lapMs ?? null)
  if (pb) out.push(pb)
  if (best && d.teammate?.bestMs) {
    const dt = best.lapMs - d.teammate.bestMs
    out.push({
      label: 'vs teammate',
      val: delta(dt),
      valCls: dt < 0 ? 'up' : '',
      cap: `${d.teammate.name} ${formatLapTime(d.teammate.bestMs)}`,
    })
  }
  if (best && d.fieldBestMs) {
    const dt = best.lapMs - d.fieldBestMs
    const who = d.classification.find((c) => c.bestLapMs === d.fieldBestMs && !c.isPlayer)
    out.push(
      dt <= 0
        ? { label: 'vs field', val: 'Fastest', valCls: 'pb', cap: 'best lap of the session' }
        : {
            label: 'vs field',
            val: delta(dt),
            cap: who ? `${who.name} ${formatLapTime(d.fieldBestMs)}` : formatLapTime(d.fieldBestMs),
          },
    )
  }
  if (k === 'race' && d.points != null)
    out.push({ label: 'Points', val: String(d.points), cap: '' })
  if (k === 'practice' && d.consistencyMs != null)
    out.push({
      label: 'Consistency',
      val: `±${(d.consistencyMs / 1000).toFixed(2)}`,
      cap: 'valid laps',
    })
  return out
}

function lapChart(d: SessionDetail): string {
  const laps = d.laps.filter((l) => l.lapMs > 0)
  if (laps.length < 3) return ''
  const best = bestLap(d)?.lapMs ?? Math.min(...laps.map((l) => l.lapMs))
  // The in-lap of every stint but the last is a pit lap.
  const pits = new Set(d.stints.slice(0, -1).map((s) => s.toLap))
  const bars = laps
    .map((l, i) => {
      const pit = pits.has(l.lap)
      const isBest = l.valid && !l.flashback && l.lapMs === best
      const cls = isBest
        ? 'is-best'
        : l.flashback
          ? 'is-flashback'
          : !l.valid
            ? 'is-invalid'
            : pit
              ? 'is-pit'
              : ''
      const h = pit ? 1 : Math.min(1, Math.max(0.04, (l.lapMs - best) / 3000))
      const why = [
        !l.valid ? 'invalid' : '',
        l.flashback ? 'flashback, out of stats' : '',
        pit ? 'pit stop' : '',
        isBest ? 'best' : '',
      ].filter(Boolean)
      return `<i class="${cls}" style="--h: ${h.toFixed(3)}; --i: ${i}" title="${esc(`Lap ${l.lap} · ${formatLapTime(l.lapMs)}${why.length ? ` · ${why.join(' · ')}` : ''}`)}"></i>`
    })
    .join('')
  const has = (c: string) => bars.includes(`class="${c}"`)
  const legend = [
    ['is-best', 'Best'],
    ['is-invalid', 'Invalid'],
    ['is-flashback', 'Flashback, out of stats'],
    ['is-pit', 'Pit'],
  ]
    .filter(([c]) => c === 'is-best' || has(c!))
    .map(([c, t]) => `<span><i class="${c}"></i>${t}</span>`)
    .join('')
  return `<section class="gp-panel gp-enter" style="--i: 3"><div class="panel-head"><span class="gp-label">Laps · gap to best</span><span class="spacer"></span><div class="gp-legend">${legend}</div></div>
<div class="gp-lapchart"><div class="gp-lapchart-axis"><span>+3.0</span><span>+2.0</span><span>+1.0</span><span>0</span></div><div class="gp-lapchart-bars">${bars}</div><div class="gp-lapchart-x"><span>Lap ${laps[0]!.lap}</span><span>Lap ${laps[laps.length - 1]!.lap}</span></div></div></section>`
}

function sectors(d: SessionDetail): string {
  const best = bestLap(d)
  if (!best || countedLaps(d).length < 2 || best.sectorsMs.every((s) => s == null)) return ''
  const cells = best.sectorsMs
    .map((t, i) => {
      const b = d.bestSectorsMs[i]
      const dt = t != null && b != null ? t - b : null
      const cls = dt == null ? '' : dt <= 0 ? 'is-personal' : 'is-slower'
      return `<div class="gp-sector ${cls}" style="--i: ${i}"><span class="gp-label">S${i + 1}</span><span class="gp-sector-time">${secs(t)}</span><span class="gp-sector-delta">${dt == null ? '' : dt <= 0 ? 'best' : delta(dt)}</span></div>`
    })
    .join('')
  return `<section class="gp-panel gp-enter" style="--i: 4"><div class="panel-head"><span class="gp-label">Best lap sectors</span><span class="spacer"></span><span class="faint" style="font-size: 12px">vs session best</span></div><div class="gp-sectors">${cells}</div></section>`
}

function stints(d: SessionDetail): string {
  if (!d.stints.length) return ''
  const tt = kindOf(d) === 'tt'
  const rows = d.stints
    .map((s) => {
      const wear =
        s.wearPerLapPct != null ? Math.max(0, s.wearPerLapPct * Math.max(1, s.laps - 1)) : null
      return `<div class="stint"><span>${esc(s.tyre ?? 'Tyre unknown')}<span class="faint" style="display: block; font-size: 12px">${esc(
        s.fromLap === s.toLap ? `Lap ${s.fromLap}` : `Laps ${s.fromLap}–${s.toLap}`,
      )}</span></span><span class="gp-meterbar" style="--v: ${wear != null ? Math.min(1, wear / 100).toFixed(3) : 0}"><i></i></span><span class="num r" style="text-align: right">${
        tt ? 'TT' : wear != null ? `${Math.round(wear)}%` : '–'
      }</span></div>`
    })
    .join('')
  return `<section class="gp-panel gp-enter" style="--i: 5"><div class="panel-head"><span class="gp-label">Stints and tyre wear</span><span class="spacer"></span><span class="faint" style="font-size: 12px">${
    d.stints.length > 1 ? plural(d.stints.length - 1, 'stop') : ''
  }</span></div>${rows}</section>`
}

function incidents(d: SessionDetail): string {
  if (!d.incidents.length) return ''
  const rows = d.incidents.map((i) => {
    const cls = i.undone ? 'undone' : ''
    return [
      { v: i.lap != null ? `L${i.lap}` : '', cls: 'k' },
      { v: INCIDENT[i.kind] ?? i.kind, cls },
      { v: `${i.detail ?? ''}${i.undone ? '. Undone by a flashback, out of stats' : ''}`, cls },
    ]
  })
  return `<section class="gp-panel gp-enter" style="--i: 6"><div class="panel-head"><span class="gp-label">Incidents</span></div>${table('48px 120px 1fr', null, rows)}</section>`
}

function setupPanel(d: SessionDetail): string {
  if (!d.setups.length) return ''
  const base = d.setups[0]!.values
  const lines: string[] = []
  d.setups.slice(1).forEach((s, i) => {
    const from = d.laps.find((l) => l.setup === i + 1)?.lap
    const ch = Object.keys(SETUP_LABELS)
      .filter(
        (k) =>
          typeof base[k] === 'number' && typeof s.values[k] === 'number' && base[k] !== s.values[k],
      )
      .map((k) => `${SETUP_LABELS[k]} ${base[k]} → ${s.values[k]}`)
    if (ch.length) lines.push(`${from ? `From lap ${from}: ` : ''}${ch.join(', ')}`)
  })
  if (!lines.length) {
    const v = (k: string) => (typeof base[k] === 'number' ? base[k] : null)
    const parts = [
      v('frontWing') != null && v('rearWing') != null
        ? `Wings ${v('frontWing')} / ${v('rearWing')}`
        : '',
      v('onThrottle') != null ? `Diff ${v('onThrottle')}% on throttle` : '',
      v('brakeBias') != null ? `Brake bias ${v('brakeBias')}%` : '',
    ].filter(Boolean)
    lines.push('Same setup all session', ...(parts.length ? [parts.join(' · ')] : []))
  }
  return `<section class="gp-panel gp-enter" style="--i: 7"><div class="panel-head"><span class="gp-label">Setup</span></div><ul class="setup-list">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`
}

/** GP's words: three parts for new debriefs, the one-line record for older ones. */
function debriefPanel(d: SessionDetail, writing: boolean): string {
  const parts = d.debriefParts
  const body = parts
    ? `<div class="say"><div><span class="gp-label">Went well</span><p>${esc(parts.well)}</p></div><div><span class="gp-label">Cost time</span><p>${esc(parts.cost)}</p></div><div><span class="gp-label">Work on</span><p>${esc(parts.work)}</p></div></div>`
    : d.debrief
      ? `<p class="say-text">${esc(d.debrief)}</p>`
      : writing
        ? `<div class="row muted"><span class="gp-spinner"></span>GP is writing this debrief. Laps, stints and incidents are already saved.</div>`
        : ''
  if (!body) return ''
  return `<section class="gp-panel gp-enter" style="--i: 2">${gpHead("GP's debrief")}${body}</section>`
}

// ------------------------------------------------------------------ page

export function debriefPage(root: HTMLElement): () => void {
  root.innerHTML = `<div class="debrief gp-page">
<aside class="lib" aria-label="Library">
<div class="lib-head">
<div class="gp-seg" role="group" aria-label="Program">${PROGRAMS.map(([p, l]) => `<button data-prog="${p}" aria-pressed="false">${l}</button>`).join('')}</div>
<input class="gp-input" type="search" placeholder="Search tracks" aria-label="Search tracks" style="height: 32px" data-q>
<div class="row hidden" data-simchips><button class="gp-chip" data-sim="all" aria-pressed="true">All modes</button><button class="gp-chip" data-sim="gp" aria-pressed="false">Grand Prix</button></div>
</div>
<div class="lib-body" data-lib><div class="lib-skel"><span class="gp-skel" style="width: 50%"></span><span class="gp-skel" style="width: 90%; height: 28px"></span><span class="gp-skel" style="width: 90%; height: 28px"></span><span class="gp-skel" style="width: 90%; height: 28px"></span><span class="gp-skel" style="width: 40%"></span><span class="gp-skel" style="width: 90%; height: 28px"></span></div></div>
</aside>
<div class="detail" data-detail><div class="page writing"><span class="gp-skel" style="width: 30%; height: 14px"></span><span class="gp-skel" style="width: 60%; height: 26px"></span><span class="gp-skel" style="width: 100%; height: 72px"></span><span class="gp-skel" style="width: 100%; height: 140px"></span></div></div>
</div>`
  const lib = $('[data-lib]', root)
  const detail = $('[data-detail]', root)
  const q = $<HTMLInputElement>('[data-q]', root)
  const simChips = $('[data-simchips]', root)

  let program: Program = 'career'
  let simGP = false
  let lists: Partial<Record<Program, SessionListItem[]>> = {}
  let error: string | null = null
  let sel: Sel | null = null
  let picked = false
  let detailKey = ''
  let menuOpen = false
  let careers: CareersInfo | null = null
  let alive = true

  const current = () => lists[program] ?? null
  const shown = () => {
    const term = q.value.trim().toLowerCase()
    const l = current() ?? []
    return term ? l.filter((s) => s.track.toLowerCase().includes(term)) : l
  }
  const groups = (): Group[] => {
    const l = shown()
    return program === 'career'
      ? careerGroups(l)
      : program === 'time_trial'
        ? ttGroups(l)
        : simGroups(l, simGP)
  }

  const renderLib = () => {
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-prog]'))
      b.setAttribute('aria-pressed', String(b.dataset.prog === program))
    simChips.classList.toggle('hidden', program !== 'sim')
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-sim]'))
      b.setAttribute('aria-pressed', String((b.dataset.sim === 'gp') === simGP))
    if (!current()) return
    const gs = groups()
    if (!gs.length) {
      setHtml(
        lib,
        `<p class="faint" style="padding: 16px 10px">${
          q.value.trim()
            ? `No ${esc(q.value.trim())} sessions here.`
            : program === 'career'
              ? 'Career sessions appear here, filed by career and season.'
              : program === 'time_trial'
                ? 'Time trial runs appear here, filed by car.'
                : 'Grand Prix, custom and online sessions appear here.'
        }</p>`,
      )
      return
    }
    let n = 0
    setHtml(
      lib,
      `<div class="gp-list">${gs
        .map(
          (g) =>
            `<span class="gp-list-group gp-label">${esc(g.label)}</span>${g.items
              .map(
                (x) =>
                  `<button class="gp-list-item" data-sel="${esc(JSON.stringify(x.sel))}" data-status="${esc(x.status)}" style="--i: ${Math.min(n++, 14)}"><span class="gp-team-tick" style="--gp-team: ${x.team}"></span><span class="gp-list-main"><span class="gp-list-title">${esc(x.title)}</span><span class="gp-list-meta">${esc(x.meta)}</span></span><span class="gp-list-end">${esc(x.end)}</span></button>`,
              )
              .join('')}`,
        )
        .join('')}</div>`,
    )
    markCurrent()
  }
  const markCurrent = () => {
    for (const b of lib.querySelectorAll<HTMLElement>('[data-sel]'))
      b.setAttribute('aria-current', String(same(sel, JSON.parse(b.dataset.sel!) as Sel)))
  }

  const load = async (p: Program) => {
    try {
      lists[p] = await gp().sessions({ program: p, limit: 300 })
      error = null
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      lists[p] ??= []
    }
  }

  const firstSel = (): Sel | null => {
    const s = groups()[0]?.items.find((x) => x.sel.kind === 'session') ?? groups()[0]?.items[0]
    return s?.sel ?? null
  }

  const pick = (s: Sel | null, user = false) => {
    if (user) picked = true
    sel = s
    menuOpen = false
    markCurrent()
    void renderDetail()
  }

  /** The window stays quiet while you drive (unless you picked something). */
  const driving = () => !picked && !!get().status?.game.receiving

  const renderDetail = async (force = false) => {
    const banner = error
      ? `<div class="banners" style="padding-bottom: 0"><div class="gp-banner"><span class="gp-dot gp-dot--bad"></span><span class="gp-banner-text"><b>Couldn't read the sessions.</b> ${esc(error)}</span><button class="gp-button gp-button--sm" data-retry>Retry</button></div></div>`
      : ''
    if (driving()) {
      const g = get().status!.game
      const key = `drive:${g.mode}:${g.track}:${g.sessionType}`
      if (!force && key === detailKey) return
      detailKey = key
      detail.innerHTML = `${banner}<div class="driving gp-page"><span class="gp-dot gp-dot--live gp-dot--pulse" style="width: 10px; height: 10px"></span><h1 class="title">You're on track</h1><p class="muted">The window stays quiet while you drive. GP is on the radio, and the debrief opens here when the session ends.</p><div class="facts"><div><span class="gp-label">Mode</span><div>${esc(g.mode ?? 'Detecting…')}</div></div><div><span class="gp-label">Session</span><div>${esc([g.track, g.sessionType].filter(Boolean).join(' · ') || 'Detecting…')}</div></div></div></div>`
      return
    }
    const all = Object.values(lists).flat() as SessionListItem[]
    if (!sel) {
      const empty = !all.length && program === 'career' && !current()?.length
      const key = `empty:${program}:${empty}`
      if (!force && key === detailKey) return
      detailKey = key
      detail.innerHTML = `${banner}<div class="gp-empty" style="margin-top: 80px">${mark(28)}<h3>${empty ? 'No sessions yet' : 'Nothing here yet'}</h3><p>${
        empty
          ? 'Drive any session in F1 23. When it ends GP files it here and writes the debrief.'
          : 'Pick another tab, or drive a session of this kind.'
      }</p>${empty ? '<button class="gp-button" data-go="status">Check the radio is ready</button>' : ''}</div>`
      return
    }
    if (sel.kind === 'session') return renderSession(sel.uid, banner, force)
    if (sel.kind === 'weekend') return renderWeekend(sel.link, banner, force)
    return renderCar(sel.car, banner, force)
  }

  const renderSession = async (uid: string, banner: string, force: boolean) => {
    const item = (current() ?? []).find((s) => s.uid === uid)
    const key = `s:${uid}:${item?.hasDebrief}:${item?.pendingSync}:${item?.status}:${menuOpen}`
    if (!force && key === detailKey) return
    detailKey = key
    let d: SessionDetail | null = null
    try {
      d = await gp().sessionDetail(uid)
    } catch (e) {
      d = null
      error = e instanceof Error ? e.message : String(e)
    }
    if (!alive || detailKey !== key) return
    if (!d) {
      detail.innerHTML = `${banner}<div class="gp-empty" style="margin-top: 80px"><h3>Session not found</h3><p>It may have been moved or merged. Pick another from the list.</p></div>`
      return
    }
    const db = get().status?.database
    const endedMs = Date.parse(d.startedAt) + d.durationS * 1000
    const writing = !d.debrief && Date.now() - endedMs < 5 * 60_000
    const replaced = d.replacedBy ? (current() ?? []).find((s) => s.uid === d!.replacedBy) : null
    const earlier = (current() ?? []).filter((s) => s.replacedBy === d!.uid)
    const chips = [
      `<span class="gp-chip"><span class="gp-team-tick" style="--gp-team: ${teamOf(d)}"></span>${esc(filing(d))}</span>`,
      d.status === 'restarted'
        ? '<span class="gp-chip gp-chip--quiet">Restarted, kept out of stats</span>'
        : '',
      d.status === 'abandoned'
        ? '<span class="gp-chip gp-chip--quiet">Abandoned, pace only</span>'
        : '',
      d.flashbacks
        ? `<span class="gp-chip gp-chip--quiet">${plural(d.flashbacks, 'flashback')}</span>`
        : '',
      !db?.configured
        ? '<span class="gp-chip gp-chip--quiet">On this Mac</span>'
        : d.pendingSync
          ? '<span class="gp-chip gp-chip--warn gp-pop">Not synced yet</span>'
          : '<span class="gp-chip gp-fade-in"><span class="gp-dot gp-dot--good"></span>Synced</span>',
    ].join('')
    const weather = [d.weather, d.trackTempC != null ? `track ${d.trackTempC}°` : '']
      .filter(Boolean)
      .join(', ')
    const sub = [
      longWhen(d.startedAt),
      d.totalLaps && kindOf(d) === 'race'
        ? `${d.lapsDone} of ${d.totalLaps} laps`
        : plural(d.lapsDone, 'lap'),
      d.car ?? d.team,
      weather,
    ]
      .filter(Boolean)
      .join(' · ')
    const canFile = d.status !== 'restarted'
    const attempt =
      d.status === 'restarted'
        ? `<div class="attempt gp-enter">Restarted after ${plural(d.lapsDone, 'lap')}. Kept here so you can look back, but it is out of every stat, every PB and every call GP makes.${
            replaced
              ? ` <button class="gp-button gp-button--sm" data-open="${esc(replaced.uid)}">Open the run that counts</button>`
              : ''
          }</div>`
        : earlier.length
          ? `<div class="attempt gp-enter" style="--i: 8"><span class="gp-chip gp-chip--quiet">${plural(earlier.length, 'earlier attempt')}</span>Restarted before this run, out of stats. <button class="gp-button gp-button--sm gp-button--ghost" data-open="${esc(earlier[0]!.uid)}">Open</button></div>`
          : ''
    const side = [sectors(d), stints(d)].filter(Boolean)
    detail.innerHTML = `${banner}<div class="page gp-page">
<div class="chips">${chips}</div>
<div class="page-head"><div><h1 class="title">${esc(`${d.track} · ${d.sessionType}`)}</h1><p class="sub">${esc(sub)}</p></div><span class="spacer"></span>
${canFile ? `<div class="rel"><button class="gp-button" data-menu>Change filing</button>${menuOpen ? fileMenu(d) : ''}</div>` : ''}</div>
<div class="stack">
${hero(sessionHero(d))}
${d.status === 'restarted' ? attempt : ''}
${d.status !== 'restarted' ? debriefPanel(d, writing) : ''}
${lapChart(d)}
${side.length === 2 ? `<div class="grid2">${side.join('')}</div>` : side.join('')}
${incidents(d)}
${setupPanel(d)}
${d.status !== 'restarted' ? attempt : ''}
</div></div>`
  }

  let menuProg: Program = 'career'
  const fileMenu = (d: SessionDetail) => {
    const cs = careers?.careers ?? []
    const canCareer = d.seasonLink != null
    const seg = PROGRAMS.map(
      ([p, l]) =>
        `<button data-mprog="${p}" aria-pressed="${menuProg === p}" style="flex: 1"${p === 'career' && !canCareer ? ' disabled title="The game gave this session no season"' : ''}>${l}</button>`,
    ).join('')
    return `<div class="menu" data-filemenu><span class="gp-label">File this session as</span>
<div class="gp-seg" style="display: flex">${seg}</div>
<div class="${menuProg === 'career' ? '' : 'hidden'}" data-careerwrap style="display: grid; gap: 12px">
<label class="gp-field"><span class="gp-field-label">Career</span><select class="gp-input" style="width: 100%" data-career>${cs
      .map(
        (c) =>
          `<option value="${esc(c.id)}"${d.career?.id === c.id ? ' selected' : ''}>${esc(c.name)}</option>`,
      )
      .join('')}<option value="">New career…</option></select></label>
<label class="gp-field${cs.length ? ' hidden' : ''}" data-newwrap><span class="gp-field-label">Name</span><input class="gp-input" style="width: 100%" data-newname value="Career ${cs.length + 1}"></label>
<p class="faint" style="font-size: 12px">The whole season moves with it.</p></div>
<p class="faint" style="font-size: 12px">Use this when GP couldn't tell, or guessed wrong. Stats recompute.</p>
<p class="gp-field-error hidden" data-fileerr></p>
<div class="row"><span class="spacer"></span><button class="gp-button gp-button--ghost" data-menu>Cancel</button><button class="gp-button gp-button--primary" data-move="${esc(d.uid)}">Move</button></div></div>`
  }

  const renderWeekend = async (link: number, banner: string, force: boolean) => {
    const wk = (current() ?? []).filter((s) => s.weekendLink === link)
    const key = `w:${link}:${wk.map((s) => s.uid + s.hasDebrief).join()}`
    if (!force && key === detailKey) return
    detailKey = key
    if (!wk.length) return pick(firstSel())
    const counted = wk.filter((s) => s.status === 'finished')
    const race = counted.find((s) => kindOf(s) === 'race')
    const quali = counted.find((s) => kindOf(s) === 'quali')
    const practice = counted.filter((s) => kindOf(s) === 'practice')
    const s0 = wk[0]!
    const bestP = Math.min(...practice.map((s) => s.bestLapMs ?? Infinity))
    const hs: Hero[] = [
      {
        label: 'Finish',
        big: race?.finishPos ? `P${race.finishPos}` : '–',
        cap:
          race?.gridPos && race.finishPos
            ? `Grid P${race.gridPos}${race.gridPos > race.finishPos ? `, ${plural(race.gridPos - race.finishPos, 'place')} gained` : ''}`
            : race
              ? ''
              : 'no race yet',
        capCls: race?.gridPos && race.finishPos && race.gridPos > race.finishPos ? 'up' : '',
      },
    ]
    if (race?.points != null) hs.push({ label: 'Points', val: String(race.points), cap: '' })
    if (quali?.finishPos)
      hs.push({
        label: 'Qualifying',
        val: `P${quali.finishPos}`,
        cap: formatLapTime(quali.bestLapMs),
      })
    if (race?.bestLapMs && Number.isFinite(bestP)) {
      const dt = race.bestLapMs - bestP
      hs.push({
        label: 'Practice to race',
        val: delta(dt),
        valCls: dt < 0 ? 'up' : '',
        cap: 'best lap, practice vs race',
      })
    }
    let raceText = ''
    if (race?.hasDebrief) {
      try {
        raceText = (await gp().sessionDetail(race.uid))?.debrief ?? ''
      } catch {}
    }
    if (!alive || detailKey !== key) return
    const ordered = [...wk].reverse()
    const rows = ordered.map((s) => [
      {
        v: s.sessionType + (s.status === 'restarted' ? ', restarted' : ''),
        cls: s.status !== 'finished' ? 'undone' : '',
      },
      { v: s.finishPos ? `P${s.finishPos}` : '–', cls: 'd' },
      { v: formatLapTime(s.bestLapMs).replace('--:--.---', '–'), cls: 'd' },
      {
        v: [plural(s.lapsDone, 'lap'), s.status === 'abandoned' ? 'abandoned' : '']
          .filter(Boolean)
          .join(' · '),
        cls: 'k',
      },
    ])
    const team = teamColorByName(s0.car ?? s0.team)
    detail.innerHTML = `${banner}<div class="page gp-page">
<div class="chips"><span class="gp-chip"><span class="gp-team-tick" style="--gp-team: ${team}"></span>${esc(filing(s0))}</span></div>
<div class="page-head"><div><h1 class="title">${esc(`${s0.track} · Weekend`)}</h1><p class="sub">${esc(
      [
        `${day(ordered[0]!.startedAt)} – ${day(s0.startedAt)}`,
        plural(counted.length, 'session'),
        s0.car ?? s0.team,
      ]
        .filter(Boolean)
        .join(' · '),
    )}</p></div></div>
<div class="stack">${hero(hs)}
${raceText ? `<section class="gp-panel gp-enter" style="--i: 2">${gpHead('GP after the race')}<p>${esc(raceText)}</p></section>` : ''}
<section class="gp-panel gp-enter" style="--i: 3"><div class="panel-head"><span class="gp-label">Sessions</span></div>${table(
      '1.2fr 64px 1fr 1.2fr',
      ['Session', 'Pos', 'Best', 'Notes'],
      rows,
      ordered.map((s) => s.uid),
    )}</section>
</div></div>`
  }

  const renderCar = async (car: string, banner: string, force: boolean) => {
    const ss = (current() ?? []).filter((s) => (s.car ?? s.team ?? 'Unknown car') === car)
    const key = `c:${car}:${ss.length}`
    if (!force && key === detailKey) return
    detailKey = key
    const tracks = new Map<number, SessionListItem[]>()
    for (const s of ss) {
      if (!tracks.has(s.trackId)) tracks.set(s.trackId, [])
      tracks.get(s.trackId)!.push(s)
    }
    const laps = ss.reduce((a, s) => a + s.lapsDone, 0)
    const valid = ss.reduce((a, s) => a + s.validLaps, 0)
    const restarts = ss.filter((s) => s.status === 'restarted').length
    const rows = [...tracks.values()].map((t) => {
      const best = Math.min(
        ...t.filter((s) => s.status === 'finished').map((s) => s.bestLapMs ?? Infinity),
      )
      return [
        { v: t[0]!.track },
        { v: Number.isFinite(best) ? formatLapTime(best) : '–', cls: 'd' },
        { v: String(t.reduce((a, s) => a + s.lapsDone, 0)), cls: 'd' },
        { v: String(t.filter((s) => s.status === 'restarted').length), cls: 'd' },
        { v: day(t[0]!.startedAt), cls: 'k' },
      ]
    })
    detail.innerHTML = `${banner}<div class="page gp-page">
<div class="chips"><span class="gp-chip"><span class="gp-team-tick" style="--gp-team: ${teamColorByName(car)}"></span>Time trial</span></div>
<div class="page-head"><div><h1 class="title">${esc(car)}</h1><p class="sub">Car profile · every time trial run in this car</p></div></div>
<div class="stack">${hero([
      { label: 'Tracks', big: String(tracks.size), cap: '' },
      { label: 'Laps', val: String(laps), cap: `${valid} valid` },
      { label: 'Restarts', val: String(restarts), cap: 'never counted' },
    ])}
<section class="gp-panel gp-enter" style="--i: 1"><div class="panel-head"><span class="gp-label">Per track</span></div>${table(
      '1.2fr 1fr 0.6fr 0.7fr 1fr',
      ['Track', 'Best', 'Laps', 'Restarts', 'Last driven'],
      rows,
      [...tracks.values()].map((t) => t[0]!.uid),
    )}</section>
</div></div>`
  }

  // ---------------------------------------------------------------- events

  const switchTo = async (p: Program) => {
    program = p
    picked = false
    renderLib()
    if (!lists[p]) {
      lib.innerHTML = `<div class="lib-skel"><span class="gp-skel" style="width: 50%"></span><span class="gp-skel" style="width: 90%; height: 28px"></span><span class="gp-skel" style="width: 90%; height: 28px"></span></div>`
      delete lib.dataset.html
      await load(p)
    }
    renderLib()
    pick(firstSel())
  }

  root.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement
    const prog = t.closest<HTMLElement>('[data-prog]')
    if (prog) return void switchTo(prog.dataset.prog as Program)
    const sim = t.closest<HTMLElement>('[data-sim]')
    if (sim) {
      simGP = sim.dataset.sim === 'gp'
      renderLib()
      return pick(firstSel())
    }
    const item = t.closest<HTMLElement>('[data-sel]')
    if (item) return pick(JSON.parse(item.dataset.sel!) as Sel, true)
    const open = t.closest<HTMLElement>('[data-open],[data-pick]')
    if (open) {
      const uid = open.dataset.open ?? open.dataset.pick!
      return pick({ kind: 'session', uid }, true)
    }
    if (t.closest('[data-retry]')) {
      await load(program)
      renderLib()
      return void renderDetail(true)
    }
    const go = t.closest<HTMLElement>('[data-go]')
    if (go)
      return void document.querySelector<HTMLElement>(`[data-page="${go.dataset.go}"]`)?.click()
    if (t.closest('[data-menu]')) {
      menuOpen = !menuOpen
      menuProg = program
      if (menuOpen && !careers)
        careers = await gp()
          .careers()
          .catch(() => null)
      return void renderDetail(true)
    }
    const mp = t.closest<HTMLButtonElement>('[data-mprog]')
    if (mp) {
      menuProg = mp.dataset.mprog as Program
      for (const b of root.querySelectorAll<HTMLElement>('[data-mprog]'))
        b.setAttribute('aria-pressed', String(b === mp))
      $('[data-careerwrap]', root).classList.toggle('hidden', menuProg !== 'career')
      return
    }
    const move = t.closest<HTMLButtonElement>('[data-move]')
    if (move) {
      const uid = move.dataset.move!
      const fail = (msg: string) => {
        const err = $('[data-fileerr]', root)
        err.textContent = msg
        err.classList.remove('hidden')
        move.disabled = false
      }
      move.disabled = true
      const was = (Object.values(lists).flat() as SessionListItem[]).find((s) => s.uid === uid)
      if (menuProg !== program) {
        const r = await gp().setProgram(uid, menuProg)
        if ('error' in r) return fail(r.error)
      }
      if (menuProg === 'career' && was?.seasonLink != null) {
        const id = $<HTMLSelectElement>('[data-career]', root).value
        const name = $<HTMLInputElement>('[data-newname]', root).value.trim()
        if (!id || id !== was.career?.id) {
          const r = await gp().assignSeason(
            was.seasonLink,
            id ? { careerId: id } : { newCareer: name || 'New career' },
          )
          if ('error' in r) return fail(r.error)
          careers = r
        }
      }
      menuOpen = false
      lists = {}
      await Promise.all(PROGRAMS.map(([p]) => load(p)))
      program = menuProg
      picked = true
      renderLib()
      pick({ kind: 'session', uid }, true)
    }
  })
  root.addEventListener('change', (e) => {
    const t = e.target as HTMLElement
    if (t.matches('[data-career]'))
      $('[data-newwrap]', root).classList.toggle('hidden', (t as HTMLSelectElement).value !== '')
  })
  root.addEventListener('keydown', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]')
    if (row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      row.click()
    }
  })
  q.addEventListener('input', () => {
    renderLib()
    if (sel && !lib.querySelector('[aria-current="true"]')) pick(firstSel())
  })

  // New sessions land when one ends: reload when the game goes quiet, and every 20 s anyway.
  let wasDriving = !!get().status?.game.receiving
  const refresh = async () => {
    const before = current()?.[0]?.uid
    await load(program)
    if (!alive) return
    renderLib()
    const after = current()?.[0]?.uid
    if (after && after !== before && !picked) pick(firstSel())
    else void renderDetail()
  }
  const unwatch = watch(['status'], ({ status }) => {
    const now = !!status?.game.receiving
    if (now !== wasDriving) {
      wasDriving = now
      if (!now) setTimeout(() => void refresh(), 1500)
      else void renderDetail()
    }
  })
  const timer = setInterval(() => void refresh(), 20_000)

  void (async () => {
    await load('career')
    // Open on the tab of the latest session.
    const latest = (
      await Promise.all(
        (['time_trial', 'sim'] as Program[]).map(async (p) => {
          await load(p)
          return lists[p]?.[0]
        }),
      )
    )
      .concat(lists.career?.[0])
      .filter(Boolean)
      .sort((a, b) => Date.parse(b!.startedAt) - Date.parse(a!.startedAt))[0]
    if (!alive) return
    if (latest) program = latest.program
    renderLib()
    pick(firstSel())
  })()

  return () => {
    alive = false
    clearInterval(timer)
    unwatch()
    lists = {}
  }
}
