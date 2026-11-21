/**
 * The GP mark: the app icon's six waveform bars (white, the tallest one red), without the tile.
 * Used next to the "GP" wordmark in app headers. `tile` draws the rounded graphite tile too,
 * which is the app icon itself at small sizes.
 */
const BARS = [
  [246, 424, 176],
  [340, 347, 330],
  [434, 271, 482],
  [528, 372, 280],
  [622, 310, 404],
  [716, 436, 152],
] as const

export interface MarkOptions {
  /** Height in px. Default 20. */
  size?: number
  /** Draw the app-icon tile behind the bars. */
  tile?: boolean
  /** Accessible name. Default "GP". Pass '' to hide it from screen readers. */
  label?: string
}

export function gpMark({ size = 20, tile = false, label = 'GP' }: MarkOptions = {}): string {
  const bars = BARS.map(
    ([x, y, h], i) =>
      `<rect class="bar" style="--i:${i}" x="${x}" y="${y}" width="62" height="${h}" rx="31" fill="${i === 2 ? 'var(--gp-color-accent, #e10600)' : 'currentColor'}"/>`,
  ).join('')
  const view = tile ? '100 100 824 824' : '220 260 584 504'
  const bg = tile
    ? '<rect x="100" y="100" width="824" height="824" rx="185" fill="#15171c"/><rect x="186" y="510" width="652" height="4" rx="2" fill="#fff" fill-opacity="0.1"/>'
    : ''
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'
  const w = Math.round((size * (tile ? 824 : 584)) / (tile ? 824 : 504))
  return `<svg class="gp-mark" ${a11y} viewBox="${view}" width="${w}" height="${size}" xmlns="http://www.w3.org/2000/svg">${bg}<g transform="translate(512 512) skewX(-8) translate(-512 -512)">${bars}</g></svg>`
}
