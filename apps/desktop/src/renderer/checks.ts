import type { PreflightCheck } from '../ipc.ts'
import { esc } from './dom.ts'

export type CheckState = 'pending' | 'running' | 'ok' | 'warn' | 'fail'

export interface CheckRow {
  id: string
  name: string
  state: CheckState
  detail: string
  /** Markup for the right-hand column (rates, latency, a level meter, a key). */
  meta?: string
}

/** The start-up order (main/preflight.ts runs them in this order too). */
export const ORDER = [
  'home',
  'infisical',
  'secrets',
  'postgres',
  'sync',
  'keys',
  'claude',
  'ffmpeg',
  'mic',
  'dualsense',
  'whisper',
  'telemetry',
] as const

export const NAMES: Record<string, string> = {
  home: 'Data folder',
  infisical: 'Infisical',
  secrets: 'Secrets',
  postgres: 'Postgres',
  sync: 'Sync',
  keys: 'Voice keys',
  claude: 'Claude',
  ffmpeg: 'ffmpeg (microphone)',
  mic: 'Microphone',
  dualsense: 'DualSense',
  whisper: 'Offline speech',
  telemetry: 'F1 23 telemetry',
  session: 'Session',
  output: 'Output device',
  ptt: 'Push-to-talk',
  eleven: 'ElevenLabs voice',
  deepgram: 'Deepgram speech',
}

export const fromPreflight = (c: PreflightCheck): CheckRow => ({
  id: c.id,
  name: NAMES[c.id] ?? c.label,
  state: c.status,
  detail: c.detail,
})

/** `detail` may hold `code` spans written with backticks; everything else is text. */
const detailHtml = (s: string) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>')

function rowHtml(r: CheckRow, i: number): string {
  return `<div class="gp-check" data-id="${esc(r.id)}" data-state="${r.state}" style="--i: ${i}">
<span class="gp-check-icon" aria-hidden="true"></span>
<span class="gp-check-name">${esc(r.name)}</span>
<span class="gp-check-detail">${detailHtml(r.detail)}</span>
<span class="gp-check-meta" data-src="${esc(r.meta ?? '')}">${r.meta ?? ''}</span>
<span class="sr-only">${r.state}</span>
</div>`
}

/**
 * Renders check rows into `list`, updating rows that are already there in place so their
 * state change animates (pending ring → spinning arc → filled with a glyph) instead of
 * re-entering.
 */
export function patchChecks(list: HTMLElement, rows: CheckRow[]): void {
  const have = new Map<string, HTMLElement>()
  for (const n of list.querySelectorAll<HTMLElement>(':scope > .gp-check'))
    have.set(n.dataset.id!, n)
  let prev: Element | null = null
  rows.forEach((r, i) => {
    let n = have.get(r.id)
    if (!n) {
      const t = document.createElement('template')
      t.innerHTML = rowHtml(r, i)
      n = t.content.firstElementChild as HTMLElement
    } else {
      have.delete(r.id)
      if (n.dataset.state !== r.state) n.dataset.state = r.state
      const name = n.querySelector('.gp-check-name')!
      if (name.textContent !== r.name) name.textContent = r.name
      const d = n.querySelector('.gp-check-detail')!
      const dh = detailHtml(r.detail)
      if (d.innerHTML !== dh) d.innerHTML = dh
      const m = n.querySelector('.gp-check-meta')!
      // Compare with what was last put there: live meters change their own markup.
      if ((r.meta ?? '') !== (m as HTMLElement).dataset.src) {
        m.innerHTML = r.meta ?? ''
        ;(m as HTMLElement).dataset.src = r.meta ?? ''
      }
      n.querySelector('.sr-only')!.textContent = r.state
    }
    const next: Element | null = prev ? prev.nextElementSibling : list.firstElementChild
    if (next !== n) list.insertBefore(n, next)
    prev = n
  })
  for (const n of have.values()) n.remove()
}

/** A five-bar meter driven by the real mic level (setLevel). */
export const levelMeter = () =>
  `<span class="gp-level" data-real aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>`

/** The bars rise left to right with the level, centre bar a touch taller (the mark's shape). */
export function setLevel(root: ParentNode, level: number | null): void {
  const v = Math.max(0, Math.min(1, (level ?? 0) * 4))
  const shape = [0.55, 0.8, 1, 0.75, 0.5]
  for (const meter of root.querySelectorAll<HTMLElement>('.gp-level[data-real]'))
    meter
      .querySelectorAll<HTMLElement>('i')
      .forEach((b, i) => b.style.setProperty('--h', Math.max(0.2, v * shape[i]!).toFixed(2)))
}

export const kbd = (k: string) => `<span class="gp-kbd">${esc(k)}</span>`
