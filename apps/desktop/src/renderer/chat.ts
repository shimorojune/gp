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
      el.querySelector('.text')!.textContent += e.text
      log.scrollTop = log.scrollHeight
      break
    }
    case 'reply': {
      const el = bubbles.get(e.id) ?? add('gp', 'GP', e.text)
      bubbles.delete(e.id)
      const tools = e.tools.length ? ` · ${e.tools.join(', ')}` : ''
      meta(el, `${e.model} · ${e.firstTextMs ?? '-'}ms first words · ${e.totalMs}ms${tools}`)
      busy = false
      input.disabled = false
      input.focus()
      break
    }
    case 'radio':
      add('radio', 'GP RADIO', e.text)
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
