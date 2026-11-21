import type { ChatEvent } from '../../ipc.ts'
import { $, esc, mark } from '../dom.ts'
import { gp } from '../store.ts'

/*
 * Ask GP: the same engineer as the overlay, with every stored session behind it. The
 * conversation lives for the app run (switching pages keeps it), not on disk.
 */

interface Msg {
  who: 'you' | 'gp' | 'err'
  text: string
  src?: string
}

const SCOPES = [
  ['all', 'Everything', ''],
  ['career', 'Career', 'Only about my career mode sessions: '],
  ['time_trial', 'Time trial', 'Only about my time trials: '],
  ['sim', 'Sim', 'Only about my sim races (Grand Prix, custom, online): '],
] as const
type Scope = (typeof SCOPES)[number][0]

const SUGGEST = [
  'Where am I losing the most time lately?',
  'How did my last race go compared with qualifying?',
  'Which car is my best in time trial, and where?',
  'What should I work on before my next race?',
]

/** "get_track_history" -> "track history". */
const toolLabel = (t: string) => t.replace(/^(get|list|set)_/, '').replace(/_/g, ' ')

// Kept across page switches for this run of the app.
const log: Msg[] = []
let scope: Scope = 'all'
let pending: { text: string; id: number | null } | null = null
let listening = false
let repaint: (() => void) | null = null

/** Just enough Markdown for GP's answers: paragraphs, lists, bold, inline code and tables. */
function md(text: string): string {
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
  const out: string[] = []
  const blocks = text.trim().split(/\n{2,}/)
  for (const b of blocks) {
    const lines = b.split('\n')
    if (lines.length >= 2 && lines.every((l) => l.trim().startsWith('|'))) {
      const cells = (l: string) =>
        l
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim())
      const rows = lines.filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l)).map(cells)
      const [head, ...body] = rows
      const cols = `repeat(${head?.length ?? 1}, minmax(0, 1fr))`
      out.push(
        `<div class="gp-panel" style="padding: 10px 16px; margin-top: 4px"><div class="tbl" style="--cols: ${cols}"><div class="tr th">${(
          head ?? []
        )
          .map((c) => `<span>${inline(c)}</span>`)
          .join('')}</div>${body
          .map(
            (r, i) =>
              `<div class="tr" style="--i: ${i}">${r.map((c) => `<span class="d">${inline(c)}</span>`).join('')}</div>`,
          )
          .join('')}</div></div>`,
      )
    } else if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
      out.push(
        `<ul class="setup-list">${lines.map((l) => `<li>${inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>`).join('')}</ul>`,
      )
    } else {
      out.push(`<p>${lines.map(inline).join('<br>')}</p>`)
    }
  }
  return out.join('')
}

const avatar = `<span class="gp-msg-avatar">${mark(12)}</span>`

function msgHtml(m: Msg): string {
  if (m.who === 'you') return `<div class="gp-msg gp-msg--you">${esc(m.text)}</div>`
  if (m.who === 'err')
    return `<div class="gp-msg gp-msg--gp">${avatar}<div class="gp-msg-body"><p class="err">${esc(m.text)}</p></div></div>`
  return `<div class="gp-msg gp-msg--gp">${avatar}<div class="gp-msg-body">${md(m.text)}${m.src ? `<span class="gp-msg-src">${esc(m.src)}</span>` : ''}</div></div>`
}

function onEvent(e: ChatEvent): void {
  if (!pending) return
  if (e.type === 'delta') {
    pending.id ??= e.id
    if (e.id !== pending.id) return
    pending.text += e.text
  } else if (e.type === 'reply') {
    if (pending.id != null && e.id !== pending.id) return
    const looked = [...new Set(e.tools.map(toolLabel))]
    log.push({
      who: 'gp',
      text: e.text,
      src: [
        looked.length ? `Looked at ${looked.join(', ')}` : 'From what GP already knows',
        `${(e.totalMs / 1000).toFixed(1)} s`,
      ].join(' · '),
    })
    pending = null
  } else if (e.type === 'error') {
    log.push({ who: 'err', text: `Couldn't answer: ${e.message}` })
    pending = null
  } else return
  repaint?.()
}

export function chatPage(root: HTMLElement): () => void {
  if (!listening) {
    listening = true
    gp().onChat(onEvent)
  }
  root.innerHTML = `<div class="chatpage gp-page">
<div class="chatlog" data-log></div>
<div class="chatfoot"><form data-form>
<div class="row" data-scopes>${SCOPES.map(([k, l]) => `<button type="button" class="gp-chip" data-scope="${k}" aria-pressed="${scope === k}">${l}</button>`).join('')}</div>
<div class="gp-composer"><input class="gp-input" aria-label="Ask GP" placeholder="Ask GP about any session, car or season" autocomplete="off" data-input><button class="gp-button gp-button--primary" type="submit" data-send>Ask</button></div>
</form></div></div>`
  const logEl = $('[data-log]', root)
  const input = $<HTMLInputElement>('[data-input]', root)
  const send = $<HTMLButtonElement>('[data-send]', root)

  const paint = () => {
    const stick = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 80
    const hello =
      !log.length && !pending
        ? `<div class="chathello"><div class="gp-msg gp-msg--gp">${avatar}<div class="gp-msg-body"><p>Ask me anything about your driving: careers, time trials, sim races, setups, how you've changed. I answer from everything you've driven.</p></div></div><div class="gp-suggest" style="padding-left: 40px">${SUGGEST.map((q, i) => `<button data-suggest style="--i: ${i}">${esc(q)}</button>`).join('')}</div></div>`
        : ''
    const live = pending
      ? `<div class="gp-msg gp-msg--gp">${avatar}<div class="gp-msg-body">${
          pending.text
            ? md(pending.text)
            : '<span class="gp-typing" aria-label="GP is looking it up"><i></i><i></i><i></i></span>'
        }</div></div>`
      : ''
    logEl.innerHTML = `${hello}<div class="gp-chat">${log.map(msgHtml).join('')}${live}</div>`
    send.disabled = !!pending
    if (stick || pending) logEl.scrollTop = logEl.scrollHeight
  }
  repaint = paint
  paint()

  const ask = async (q: string) => {
    const text = q.trim()
    if (!text || pending) return
    log.push({ who: 'you', text })
    pending = { text: '', id: null }
    input.value = ''
    paint()
    const prefix = SCOPES.find(([k]) => k === scope)?.[2] ?? ''
    try {
      await gp().ask(prefix + text)
    } catch (e) {
      if (pending) {
        log.push({
          who: 'err',
          text: `Couldn't answer: ${e instanceof Error ? e.message : String(e)}`,
        })
        pending = null
        paint()
      }
    }
  }

  $('[data-form]', root).addEventListener('submit', (e) => {
    e.preventDefault()
    void ask(input.value)
  })
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    const s = t.closest<HTMLElement>('[data-suggest]')
    if (s) return void ask(s.textContent ?? '')
    const sc = t.closest<HTMLElement>('[data-scope]')
    if (sc) {
      scope = sc.dataset.scope as Scope
      for (const b of root.querySelectorAll('[data-scope]'))
        b.setAttribute('aria-pressed', String(b === sc))
    }
  })
  input.focus({ preventScroll: true })
  return () => {
    repaint = null
  }
}
