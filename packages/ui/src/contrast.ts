/** WCAG 2 contrast helpers, used by the token tests and the style guide. */

export type Rgb = [number, number, number]

/** Parse #rgb, #rrggbb or rgba(r, g, b, a). Returns rgb and alpha. */
export function parseColor(c: string): { rgb: Rgb; alpha: number } {
  const hex = c.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((x) => x + x).join('') : hex[1]!
    return { rgb: [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as Rgb, alpha: 1 }
  }
  const m = c.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i)
  if (!m) throw new Error(`Unparseable colour: ${c}`)
  return {
    rgb: [Number(m[1]), Number(m[2]), Number(m[3])],
    alpha: m[4] === undefined ? 1 : Number(m[4]),
  }
}

/** Composite a (possibly translucent) colour over an opaque background. */
export function over(fg: string, bg: Rgb): Rgb {
  const { rgb, alpha } = parseColor(fg)
  return rgb.map((v, i) => v * alpha + bg[i]! * (1 - alpha)) as Rgb
}

export function luminance([r, g, b]: Rgb): number {
  const ch = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** Contrast of colour `fg` on colour `bg` (bg composited over black if translucent). */
export function contrastOf(fg: string, bg: string): number {
  const bgRgb = over(bg, [0, 0, 0])
  return contrast(over(fg, bgRgb), bgRgb)
}
