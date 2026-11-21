/** DOM behaviour for components that need it. Browser only. */
import { esc } from './html.ts'
import { overlay } from './tokens.ts'

/** Click and arrow-key handling for a `tabs()` list. Calls onChange with the tab id. */
export function bindTabs(list: HTMLElement, onChange?: (id: string) => void): () => void {
  const tabsOf = () => [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  const select = (tab: HTMLButtonElement, focus = false) => {
    for (const t of tabsOf()) {
      const on = t === tab
      t.setAttribute('aria-selected', String(on))
      t.tabIndex = on ? 0 : -1
      const panel = document.getElementById(t.getAttribute('aria-controls') ?? '')
      if (panel) panel.hidden = !on
    }
    if (focus) tab.focus()
    onChange?.(tab.dataset.tab ?? '')
  }
  const onClick = (e: Event) => {
    const tab = (e.target as HTMLElement).closest<HTMLButtonElement>('[role="tab"]')
    if (tab) select(tab)
  }
  const onKey = (e: KeyboardEvent) => {
    const all = tabsOf()
    const i = all.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    const next =
      e.key === 'ArrowRight'
        ? all[(i + 1) % all.length]
        : e.key === 'ArrowLeft'
          ? all[(i - 1 + all.length) % all.length]
          : e.key === 'Home'
            ? all[0]
            : e.key === 'End'
              ? all[all.length - 1]
              : undefined
    if (next) {
      e.preventDefault()
      select(next, true)
    }
  }
  list.addEventListener('click', onClick)
  list.addEventListener('keydown', onKey)
  return () => {
    list.removeEventListener('click', onClick)
    list.removeEventListener('keydown', onKey)
  }
}

export interface ToastOptions {
  title: string
  body?: string
  kind?: 'info' | 'good' | 'warn' | 'bad'
  /** ms; 0 keeps it until dismissed. Errors default to 0. */
  duration?: number
}
/** Show a toast in the bottom-right region (created on first use). Returns a dismiss function. */
export function toast(o: ToastOptions): () => void {
  let region = document.querySelector<HTMLElement>('.gp-toast-region')
  if (!region) {
    region = document.createElement('div')
    region.className = 'gp-toast-region'
    region.setAttribute('aria-live', 'polite')
    document.body.append(region)
  }
  const el = document.createElement('div')
  el.className = `gp-toast${o.kind && o.kind !== 'info' ? ` gp-toast--${o.kind}` : ''}`
  el.setAttribute('role', o.kind === 'bad' ? 'alert' : 'status')
  el.innerHTML = `<div><div class="gp-toast-title">${esc(o.title)}</div>${
    o.body ? `<div class="gp-toast-body">${esc(o.body)}</div>` : ''
  }</div>`
  region.append(el)
  let gone = false
  const dismiss = () => {
    if (gone) return
    gone = true
    el.dataset.leaving = ''
    el.addEventListener('animationend', () => el.remove(), { once: true })
    setTimeout(() => el.remove(), 400)
  }
  const duration = o.duration ?? (o.kind === 'bad' ? 0 : 4000)
  if (duration > 0) setTimeout(dismiss, duration)
  el.addEventListener('click', dismiss)
  return dismiss
}

/**
 * Overlay fade cycle: show() brings a panel in, it holds for `holdMs`, then dims, then goes out.
 * Uses data-state="in|dim|out" which the CSS animates (instantly under reduced motion).
 */
export class OverlayFader {
  private timers: ReturnType<typeof setTimeout>[] = []
  constructor(
    private readonly el: HTMLElement,
    private readonly holdMs = overlay.holdMs,
    private readonly dimMs = 3000,
  ) {
    el.dataset.state = 'out'
  }
  show(): void {
    this.clear()
    this.el.dataset.state = 'in'
    const set = (state: string) => () => {
      this.el.dataset.state = state
    }
    this.timers.push(setTimeout(set('dim'), this.holdMs))
    this.timers.push(setTimeout(set('out'), this.holdMs + this.dimMs))
  }
  hide(): void {
    this.clear()
    this.el.dataset.state = 'out'
  }
  private clear(): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
  }
}

/**
 * Drive a radio card's waveform. `level` returns 0..1 (e.g. from an AnalyserNode on GP's audio);
 * without it, a gentle synthetic wave plays. Returns a stop function.
 */
export function animateWaveform(card: HTMLElement, level?: () => number): () => void {
  const bars = [...card.querySelectorAll<HTMLElement>('.gp-radio-wave i')]
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const history = bars.map(() => 0.2)
  let raf = 0
  let t = 0
  const tick = () => {
    t += 1
    const l = level
      ? level()
      : 0.35 + 0.3 * Math.sin(t / 7) * Math.sin(t / 3.1) + 0.2 * Math.random()
    history.shift()
    history.push(Math.max(0.08, Math.min(1, l)))
    bars.forEach((b, i) => b.style.setProperty('--h', history[i]!.toFixed(2)))
    if (!reduce) raf = requestAnimationFrame(tick)
  }
  tick()
  return () => cancelAnimationFrame(raf)
}
