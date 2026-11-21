import { esc, gpMark } from '@gp/ui'

export { esc }

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector<T>(sel)!

/** Parse markup into a single element. */
export function el<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement('template')
  t.innerHTML = html.trim()
  return t.content.firstElementChild as T
}

/** The mark in text colour (centre bar red), for headers and the splash. */
export const mark = (size: number) =>
  `<span style="color: var(--gp-color-text); display: inline-flex">${gpMark({ size, label: '' })}</span>`

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export const sleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, reducedMotion() ? Math.min(ms, 50) : ms))

/** "Sat 21 Nov, 19:30" in the Mac's local time. */
export function clock(d = new Date()): string {
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${day}, ${time}`
}

/** "9 Nov, 21:40" (or "today, 21:40") for an ISO time. */
export function when(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? `today, ${time}`
    : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${time}`
}

/** "12 days ago", "yesterday", "today". */
export function ago(iso: string | null | undefined): string {
  if (!iso) return ''
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  if (Number.isNaN(days)) return ''
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
}

/** Nav icons from the design (16px, 1.5 stroke). */
export const ICON = {
  debrief: '<path d="M3.5 14V2.5M3.5 3h8.5l-2 2.75L12 8.5H3.5"></path>',
  chat: '<path d="M2.5 3.5h11v7.5h-6l-3 2.5V11h-2z"></path>',
  status: '<path d="M1.5 8.5h3l1.75-4.5 3.5 8 1.75-3.5h3"></path>',
  notes: '<path d="M3.5 2.5h9v11h-9zM6 5.5h4M6 8h4M6 10.5h2.5"></path>',
  settings:
    '<path d="M2.5 4.5h7M12.5 4.5h1M2.5 11.5h1M6.5 11.5h7"></path><circle cx="11" cy="4.5" r="1.5"></circle><circle cx="5" cy="11.5" r="1.5"></circle>',
} as const

export const icon = (k: keyof typeof ICON) =>
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`

/** The mark at nav size (no accessible name: the "GP" word is next to it). */
export const gpMarkNav = () => gpMark({ size: 16, label: '' })

/** Sets innerHTML only when it changed, so entering animations don't replay on every poll. */
export function setHtml(node: HTMLElement, html: string): boolean {
  if (node.dataset.html === html) return false
  node.dataset.html = html
  node.innerHTML = html
  return true
}
