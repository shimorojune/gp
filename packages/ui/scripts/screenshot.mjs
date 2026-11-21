// Screenshots of the style guide (needs Playwright + Chromium; dev only).
// Usage: node scripts/screenshot.mjs [outDir]
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
let chromium
try {
  ;({ chromium } = require('playwright'))
} catch {
  console.error('Playwright is not installed.')
  process.exit(1)
}
const out = process.argv[2] ?? join(import.meta.dirname, '..', 'dist')
const page = pathToFileURL(join(import.meta.dirname, '..', 'dist/styleguide/index.html')).href
const browser = await chromium.launch()
const p = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })
await p.goto(page)
await p.evaluate(() => document.fonts.ready)
await p.waitForTimeout(500)
await p.screenshot({ path: join(out, 'styleguide-full.png'), fullPage: true })
await p.locator('.sg-cards').screenshot({ path: join(out, 'radio-cards.png') })
await p.locator('#ov-mock').screenshot({ path: join(out, 'overlay-mock.png') })
await browser.close()
console.log(`screenshots in ${out}`)
