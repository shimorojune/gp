/**
 * Local skin (docs/DESIGN.md): font files the driver owns in ~/Documents/GP/skin (or GP_SKIN_DIR)
 * become 'GP Skin Display', which the display token tries before the bundled Saira, and a
 * skin.css there is appended for --gp-* overrides. Node only: used by the style-guide build and
 * the desktop main process. Nothing from the skin folder ever goes into the repo or a release.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface SkinFont {
  file: string
  weight: number
  format: 'woff2' | 'woff' | 'opentype' | 'truetype'
  mime: string
}

export function skinDir(): string {
  return process.env.GP_SKIN_DIR || join(homedir(), 'Documents', 'GP', 'skin')
}

const FORMATS = {
  woff2: ['woff2', 'font/woff2'],
  woff: ['woff', 'font/woff'],
  otf: ['opentype', 'font/otf'],
  ttf: ['truetype', 'font/ttf'],
} as const

/** Font files in the skin folder, upright only, with the weight read from the file name. */
export function skinFonts(dir = skinDir()): SkinFont[] {
  if (!existsSync(dir)) return []
  const out: SkinFont[] = []
  for (const file of readdirSync(dir).sort()) {
    const ext = file.match(/\.(woff2?|otf|ttf)$/i)?.[1]?.toLowerCase() as keyof typeof FORMATS
    if (!ext || /italic/i.test(file)) continue
    // The TV names use the Wide cut, so it fills the 800 slot the names are set in.
    const weight = /black|heavy/i.test(file)
      ? 900
      : /wide/i.test(file)
        ? 800
        : /bold/i.test(file)
          ? 700
          : 400
    const [format, mime] = FORMATS[ext]
    out.push({ file, weight, format, mime })
  }
  return out
}

/** @font-face rules for the skin fonts, plus skin.css. `url` maps a font to its src URL. */
export function skinCss(url: (f: SkinFont) => string, dir = skinDir()): string {
  const faces = skinFonts(dir).map(
    (f) =>
      `@font-face { font-family: 'GP Skin Display'; font-weight: ${f.weight}; font-style: normal; font-display: swap; src: url('${url(f)}') format('${f.format}'); }`,
  )
  const extra = existsSync(join(dir, 'skin.css')) ? readFileSync(join(dir, 'skin.css'), 'utf8') : ''
  return faces.length || extra ? `/* Local skin from ${dir} */\n${faces.join('\n')}\n${extra}` : ''
}

/** Same CSS with each font inlined as a data: URL, for a renderer that can't read the folder. */
export function inlineSkinCss(dir = skinDir()): string {
  return skinCss(
    (f) => `data:${f.mime};base64,${readFileSync(join(dir, f.file)).toString('base64')}`,
    dir,
  )
}
