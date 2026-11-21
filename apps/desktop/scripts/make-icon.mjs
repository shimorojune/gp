// Generate GP's app icon: SVG sources, the 1024px master PNG and build/icon.icns.
//
//   node apps/desktop/scripts/make-icon.mjs
//
// Needs Playwright with Chromium (only for rasterising; not an app dependency):
// `npx -y playwright@1 install chromium` once if `require('playwright')` fails.
//
// Concept: the "radio waveform". A near-black macOS squircle with six rounded white bars like a
// radio voice trace, the third one in racing red: the call that matters. Palette is strictly
// near-black, white and one red (no blue). The bars lean forward like racing livery type, sit
// on a faint centre trace (a radio scope) and the red call throws a soft glow. At 16 and 32px
// the art is redrawn upright on the pixel grid so it stays a crisp waveform, not mush.
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'build')
const srcDir = join(outDir, 'icon')
mkdirSync(srcDir, { recursive: true })

const RED = '#e10600'

// macOS Big Sur+ icon grid: 1024 canvas, 824 body centred (100px margin for the shadow).
// The body is a superellipse (n=5), which is close to Apple's continuous-corner squircle and
// avoids the "blobby" look of a plain rounded rect with a big radius.
function squircle(x, y, size, n = 5, steps = 360) {
  const h = size / 2
  const cx = x + h
  const cy = y + h
  const pts = []
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI
    const c = Math.cos(t)
    const s = Math.sin(t)
    const px = cx + h * Math.sign(c) * Math.abs(c) ** (2 / n)
    const py = cy + h * Math.sign(s) * Math.abs(s) ** (2 / n)
    pts.push(`${px.toFixed(2)},${py.toFixed(2)}`)
  }
  return `M${pts.join(' L')} Z`
}

const BODY = { x: 100, y: 100, size: 824 }
const body = squircle(BODY.x, BODY.y, BODY.size)

// Art variants. Heights are in 1024-units, bars are centred on (512, 512).
//  full: six bars leaning forward 8deg, like racing livery type, on a faint centre trace.
//  px32 / px16: hand-fit to the pixel grid (every edge on a whole pixel) with fewer, fatter,
//  upright bars, so the small Finder/menu sizes stay a crisp waveform instead of grey mush.
const ART = {
  full: { heights: [176, 330, 482, 280, 404, 152], red: 2, width: 62, gap: 32, slant: -8 },
  // 32px: 1px = 32 units. 3px bars, 2px gaps, heights 12/20/10/14px.
  px32: { heights: [384, 640, 320, 448], red: 1, width: 96, gap: 64, slant: 0 },
  // 16px: 1px = 64 units. 2px bars, 2px gaps, heights 6/10/4px.
  px16: { heights: [384, 640, 256], red: 1, width: 128, gap: 128, slant: 0 },
}

function bars({ heights, red, width, gap }) {
  const total = heights.length * width + (heights.length - 1) * gap
  const x0 = 512 - total / 2
  return heights
    .map((h, i) => {
      const x = x0 + i * (width + gap)
      const fill = i === red ? 'url(#red)' : 'url(#white)'
      return `<rect x="${x}" y="${512 - h / 2}" width="${width}" height="${h}" rx="${width / 2}" fill="${fill}"/>`
    })
    .join('\n      ')
}

function svg(variant) {
  const b = ART[variant]
  const detail = variant === 'full'
  const total = b.heights.length * b.width + (b.heights.length - 1) * b.gap
  const redX = 512 - total / 2 + b.red * (b.width + b.gap) + b.width / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1c1f25"/>
      <stop offset="1" stop-color="#0e1013"/>
    </linearGradient>
    <linearGradient id="white" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#e2e2e0"/>
    </linearGradient>
    <linearGradient id="red" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff2412"/>
      <stop offset="0.5" stop-color="${RED}"/>
      <stop offset="1" stop-color="#b30500"/>
    </linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.18"/>
      <stop offset="0.4" stop-color="#ffffff" stop-opacity="0.04"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.06"/>
    </linearGradient>
    <radialGradient id="glow" cx="${redX}" cy="512" r="230" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${RED}" stop-opacity="0.16"/>
      <stop offset="1" stop-color="${RED}" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity="0.35"/>
    </filter>
    <clipPath id="clip"><path d="${body}"/></clipPath>
  </defs>
  <path d="${body}" fill="url(#bg)"${detail ? ' filter="url(#shadow)"' : ''}/>
  <g clip-path="url(#clip)">${
    detail
      ? `
    <rect x="100" y="100" width="824" height="824" fill="url(#glow)"/>
    <rect x="${512 - total / 2 - 60}" y="510" width="${total + 120}" height="4" rx="2" fill="#ffffff" fill-opacity="0.10"/>`
      : ''
  }
    <g transform="translate(512 512) skewX(${b.slant}) translate(-512 -512)">
      ${bars(b)}
    </g>
  </g>${detail ? `\n  <path d="${body}" fill="none" stroke="url(#rim)" stroke-width="3"/>` : ''}
</svg>
`
}

const art = Object.fromEntries(Object.keys(ART).map((v) => [v, svg(v)]))
writeFileSync(join(srcDir, 'icon.svg'), art.full)
writeFileSync(join(srcDir, 'icon-32.svg'), art.px32)
writeFileSync(join(srcDir, 'icon-16.svg'), art.px16)

// Rasterise with Chromium.
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const browser = await chromium.launch()
const page = await browser.newPage()
async function render(source, px) {
  await page.setViewportSize({ width: px, height: px })
  const sized = source.replace('width="1024" height="1024"', `width="${px}" height="${px}"`)
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${sized}</body></html>`,
  )
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: px, height: px } })
}
const png = {
  16: await render(art.px16, 16),
  32: await render(art.px32, 32),
  64: await render(art.full, 64),
  128: await render(art.full, 128),
  256: await render(art.full, 256),
  512: await render(art.full, 512),
  1024: await render(art.full, 1024),
}
await browser.close()
writeFileSync(join(srcDir, 'icon-1024.png'), png[1024])

// ICNS: 'icns' + total length, then (OSType, length incl. 8-byte header, PNG data) entries.
const entries = [
  ['icp4', png[16]], // 16
  ['ic11', png[32]], // 16@2x
  ['icp5', png[32]], // 32
  ['ic12', png[64]], // 32@2x
  ['ic07', png[128]], // 128
  ['ic13', png[256]], // 128@2x
  ['ic08', png[256]], // 256
  ['ic14', png[512]], // 256@2x
  ['ic09', png[512]], // 512
  ['ic10', png[1024]], // 512@2x
]
const chunks = entries.map(([type, data]) => {
  const head = Buffer.alloc(8)
  head.write(type, 0, 'ascii')
  head.writeUInt32BE(data.length + 8, 4)
  return Buffer.concat([head, data])
})
const bodyLen = chunks.reduce((n, c) => n + c.length, 0)
const header = Buffer.alloc(8)
header.write('icns', 0, 'ascii')
header.writeUInt32BE(bodyLen + 8, 4)
writeFileSync(join(outDir, 'icon.icns'), Buffer.concat([header, ...chunks]))
console.log(
  '[make-icon] wrote build/icon/{icon,icon-32,icon-16}.svg, icon-1024.png and build/icon.icns',
)
