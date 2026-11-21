// Usage: node apps/desktop/scripts/set-version.mjs 1.2.3  (called by semantic-release)
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? '')) {
  console.error(`set-version: bad version "${version}"`)
  process.exit(1)
}
const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
const pkg = JSON.parse(readFileSync(file, 'utf8'))
pkg.version = version
writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`)
console.log(`set-version: @gp/desktop ${version}`)
