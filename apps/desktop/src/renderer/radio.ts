// The overlay radio card: what GP says and what you ask over push-to-talk, as quoted lines on
// a TV-style team-radio card. Appears with a line, holds while GP is talking, then fades out.
import { type RadioLine, animateWaveform, radioCard } from '@gp/ui'
import type { RadioBridge, RadioCardEvent } from '../ipc.ts'
import { applySkin, spokenText } from './text.ts'

declare global {
  interface Window {
    gpRadio: RadioBridge
  }
}

/** An answer within this long of your question goes on the same card, under it. */
const EXCHANGE_MS = 20_000
/** Lines on the card at once: your question and GP's answer, or one call. */
const MAX_LINES = 2
/** Seconds to read a line: a base plus a bit per character, within limits. */
const holdMs = (text: string) => Math.min(9_000, Math.max(4_500, 2_500 + text.length * 55))
/** Keep the card up this long after GP stops talking. */
const AFTER_SPEECH_MS = 2_500
/** Matches --gp-motion-fade-out. */
const FADE_MS = 600
/** Never hold the card longer than this after the last line, whatever the audio says. */
const MAX_HOLD_MS = 30_000

const root = document.getElementById('card')!
let lines: (RadioLine & { at: number })[] = []
let level = 0
let lastSpeechAt = 0
let hideAt = 0
let stopWave: (() => void) | null = null
let waveLive = false
let lastLineAt = 0
let fadeTimer = 0
let doneTimer = 0

function render(e: Extract<RadioCardEvent, { type: 'line' }>): void {
  const fresh =
    !root.firstElementChild || root.firstElementChild.getAttribute('data-state') === 'out'
  stopWave?.()
  root.innerHTML = radioCard({
    driver: e.driver,
    ...(e.number != null ? { number: e.number } : {}),
    teamId: e.teamId,
    lines: lines.map(({ who, text }) => ({ who, text })),
    speaking: true,
  })
  const card = root.firstElementChild as HTMLElement
  if (fresh) card.classList.add('enter')
  waveLive = false
  wave(card)
}

/** Static stepped shape while quiet; follows GP's voice level while it talks. */
function wave(card: HTMLElement): void {
  stopWave?.()
  if (!waveLive) {
    stopWave = animateWaveform(card)
    return
  }
  // Smoothed, so the 15 Hz level from the dashboard reads as a waveform rather than steps.
  let shown = 0
  stopWave = animateWaveform(card, () => {
    shown += (level - shown) * 0.35
    return 0.15 + shown * 0.85
  })
}

function schedule(): void {
  clearTimeout(fadeTimer)
  clearTimeout(doneTimer)
  const wait = Math.max(hideAt, lastSpeechAt + AFTER_SPEECH_MS) - Date.now()
  fadeTimer = window.setTimeout(fadeOrWait, Math.min(Math.max(0, wait), 1_000))
}

function fadeOrWait(): void {
  // Still talking (a long answer): check again shortly.
  const talking = Date.now() - lastSpeechAt < AFTER_SPEECH_MS
  if (talking && Date.now() - lastLineAt < MAX_HOLD_MS) {
    schedule()
    return
  }
  const card = root.firstElementChild as HTMLElement | null
  card?.setAttribute('data-state', 'out')
  doneTimer = window.setTimeout(() => {
    stopWave?.()
    stopWave = null
    root.innerHTML = ''
    lines = []
    window.gpRadio.done()
  }, FADE_MS)
}

window.gpRadio.onEvent((e) => {
  if (e.type === 'level') {
    level = e.level
    if (e.level > 0.02) lastSpeechAt = Date.now()
    const card = root.firstElementChild as HTMLElement | null
    const speaking = Date.now() - lastSpeechAt < 400
    card?.setAttribute('data-speaking', String(speaking))
    if (card && speaking !== waveLive) {
      waveLive = speaking
      wave(card)
    }
    return
  }
  const text = spokenText(e.text)
  if (!text) return
  const now = Date.now()
  const last = lines.at(-1)
  // GP answering your question joins it; anything else is fresh news and replaces the card.
  const answer = e.who === 'gp' && last?.who === 'driver' && now - last.at < EXCHANGE_MS
  lines = answer
    ? [...lines, { who: e.who, text, at: now }].slice(-MAX_LINES)
    : [{ who: e.who, text, at: now }]
  hideAt = now + holdMs(lines.map((l) => l.text).join(' '))
  lastLineAt = now
  render(e)
  schedule()
})

void applySkin(() => window.gpRadio.skinCss())
