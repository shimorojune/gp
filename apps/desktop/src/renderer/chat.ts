import type { ChatBridge } from '../ipc.ts'

declare global {
  interface Window {
    gpChat: ChatBridge
  }
}

const log = document.getElementById('log')!
const form = document.getElementById('form') as HTMLFormElement
const input = document.getElementById('input') as HTMLInputElement
const bubbles = new Map<number, HTMLElement>()
/** Raw streamed text per reply, so a <break /> tag split across deltas still gets hidden. */
const raw = new Map<number, string>()

/** GP writes pause tags for the voice; hide them (and a half-arrived one) on screen. */
function display(text: string): string {
  return text
    .replace(/<break\b[^>]*\/?>/gi, ' ')
    .replace(/<[^>]*$/, '')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/ {2,}/g, ' ')
    .trim()
}
let busy = false

function add(cls: string, who: string, text: string): HTMLElement {
  const el = document.createElement('div')
  el.className = `msg ${cls}`
  const w = document.createElement('span')
  w.className = 'who'
  w.textContent = who
  const t = document.createElement('span')
  t.className = 'text'
  t.textContent = text
  el.append(w, t)
  log.append(el)
  log.scrollTop = log.scrollHeight
  return el
}

function meta(el: HTMLElement, text: string): void {
  const m = document.createElement('span')
  m.className = 'meta'
  m.textContent = text
  el.append(m)
  log.scrollTop = log.scrollHeight
}

window.gpChat.onEvent((e) => {
  switch (e.type) {
    case 'delta': {
      let el = bubbles.get(e.id)
      if (!el) {
        el = add('gp', 'GP', '')
        bubbles.set(e.id, el)
      }
      const text = (raw.get(e.id) ?? '') + e.text
      raw.set(e.id, text)
      el.querySelector('.text')!.textContent = display(text)
      log.scrollTop = log.scrollHeight
      break
    }
    case 'reply': {
      const el = bubbles.get(e.id) ?? add('gp', 'GP', '')
      el.querySelector('.text')!.textContent = display(e.text)
      bubbles.delete(e.id)
      raw.delete(e.id)
      const tools = e.tools.length ? ` · ${e.tools.join(', ')}` : ''
      meta(el, `${e.model} · ${e.firstTextMs ?? '-'}ms first words · ${e.totalMs}ms${tools}`)
      busy = false
      input.disabled = false
      input.focus()
      break
    }
    case 'radio':
      add('radio', 'GP RADIO', display(e.text))
      break
    case 'heard':
      meta(add('you', 'YOU (radio)', e.text), `${e.stt} · ${e.sttMs}ms`)
      break
    case 'voice':
      meta(add('you', '', ''), e.status)
      break
    case 'error':
      add('err', 'ERROR', e.message)
      busy = false
      input.disabled = false
      break
  }
})

form.addEventListener('submit', (ev) => {
  ev.preventDefault()
  const text = input.value.trim()
  if (!text || busy) return
  add('you', 'YOU', text)
  input.value = ''
  busy = true
  input.disabled = true
  void window.gpChat.ask(text)
})

window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') window.gpChat.hide()
})
window.addEventListener('focus', () => input.focus())
