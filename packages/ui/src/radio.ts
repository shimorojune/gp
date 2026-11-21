/** The team-radio card. Pairs with radio.css. */
import { esc } from './html.ts'
import { teamColor } from './tokens.ts'

export interface RadioLine {
  /** 'gp' = the engineer (white, left), 'driver' = you (team colour, right). */
  who: 'gp' | 'driver'
  text: string
}
export interface RadioCardOptions {
  /**
   * The driver whose radio this is, big in team colour, like 'NORRIS RADIO' on TV. In the app
   * it's your driver's surname from the game (participants packet), never the engineer.
   */
  driver: string
  /** Second line, white. Default 'Radio'. */
  tag?: string
  /** Car number or position, big on the waveform band. */
  number?: number | string
  /** F1 23 team id for the colour. Default GP red. */
  teamId?: number | null
  lines: RadioLine[]
  /** Dims the waveform when nobody is talking. */
  speaking?: boolean
  bars?: number
  state?: 'in' | 'out'
}

export function radioCard(o: RadioCardOptions): string {
  const bars = Array.from({ length: o.bars ?? 16 }, () => '<i></i>').join('')
  const lines = o.lines
    .map((l) => `<p class="gp-radio-line gp-radio-line--${l.who}">${esc(l.text)}</p>`)
    .join('')
  return `<div class="gp-radio" style="--gp-team:${teamColor(o.teamId)}" data-state="${o.state ?? 'in'}" data-speaking="${
    o.speaking ?? true
  }" role="log" aria-live="polite">
  <div class="gp-radio-head"><span class="gp-radio-who">${esc(o.driver)}</span><span>${esc(o.tag ?? 'Radio')}</span></div>
  <div class="gp-radio-band" aria-hidden="true"><div class="gp-radio-wave">${bars}</div>${
    o.number !== undefined ? `<span class="gp-radio-num">${esc(o.number)}</span>` : ''
  }</div>
  <div class="gp-radio-lines">${lines}</div>
</div>`
}

/**
 * Drive a card's waveform. `level` returns 0..1 (e.g. an AnalyserNode on GP's audio); without
 * it a stepped idle shape is drawn once. Returns a stop function.
 */
export function animateWaveform(card: HTMLElement, level?: () => number): () => void {
  const bars = [...card.querySelectorAll<HTMLElement>('.gp-radio-wave i')]
  const set = (vals: number[]) =>
    bars.forEach((b, i) =>
      b.style.setProperty('--h', Math.max(0.12, Math.min(1, vals[i] ?? 0.2)).toFixed(2)),
    )
  // Static stepped silhouette: tall near the number, stepping down to the right.
  const shape = bars.map(
    (_, i) => 0.25 + 0.55 * Math.abs(Math.sin(i * 1.7)) * (1 - i / bars.length),
  )
  set(shape)
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!level || reduce) return () => {}
  const history = [...shape]
  let raf = 0
  const tick = () => {
    history.pop()
    history.unshift(level())
    set(history)
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(raf)
}
