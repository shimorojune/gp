import { formatLapTime } from '@gp/shared'
import type { SessionListItem } from '../../ipc.ts'
import { esc, mark, when } from '../dom.ts'
import { gp } from '../store.ts'

/*
 * Debrief and Ask GP before their own phases land: a plain list of what's stored, and a pointer
 * to the quick chat. Real data, no sample data.
 */

const PROGRAM = { career: 'Career', time_trial: 'Time trial', sim: 'Sim' } as const

function item(s: SessionListItem, i: number): string {
  const where = [PROGRAM[s.program], s.career?.name, s.car ?? s.team].filter(Boolean).join(' · ')
  const result = s.finishPos ? `P${s.finishPos}` : formatLapTime(s.bestLapMs)
  const st = s.status !== 'finished' ? ` · ${s.status}` : ''
  return `<div class="gp-list-item" data-status="${esc(s.status)}" style="--i: ${Math.min(i, 12)}; cursor: default"><span class="gp-list-main"><span class="gp-list-title">${esc(s.track)} · ${esc(s.sessionType)}</span><span class="gp-list-meta">${esc(when(s.startedAt))} · ${esc(where)}${esc(st)}</span></span><span class="gp-list-end">${esc(result)}</span></div>`
}

export function debriefInterim(root: HTMLElement): undefined {
  root.innerHTML = `<div class="page gp-page" style="max-width: 860px"><div class="page-head"><div><h1 class="title">Debrief</h1><p class="sub">Every session GP has filed. The full debrief view for each one comes in the next update.</p></div></div><div class="gp-panel"><div class="gp-list" data-list><div class="gp-skel" style="height: 44px"></div></div></div></div>`
  void gp()
    .sessions({ limit: 40 })
    .catch(() => [] as SessionListItem[])
    .then((list) => {
      const el = root.querySelector('[data-list]')
      if (!el) return
      el.innerHTML = list.length
        ? list.map(item).join('')
        : `<div class="gp-empty">${mark(28)}<h3>No sessions yet</h3><p>Drive anything in F1 23. GP files it here when the session ends.</p></div>`
    })
}

export function chatInterim(root: HTMLElement): undefined {
  root.innerHTML = `<div class="page gp-page"><div class="gp-empty" style="margin-top: 48px">${mark(28)}<h3>Ask GP</h3><p>Chat over all your history arrives in the next update. Until then the quick chat is a keypress away: <span class="gp-kbd">⌘</span> <span class="gp-kbd">⇧</span> <span class="gp-kbd">G</span></p></div></div>`
}
