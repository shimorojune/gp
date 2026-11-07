import { cpSync, mkdirSync } from 'node:fs'
import { build } from 'esbuild'

mkdirSync('dist', { recursive: true })
const common = { bundle: true, sourcemap: true, logLevel: 'info', target: 'node20' }

await Promise.all([
  build({
    ...common,
    entryPoints: ['src/main/main.ts'],
    outfile: 'dist/main.cjs',
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  }),
  build({
    ...common,
    entryPoints: ['src/main/preload.ts'],
    outfile: 'dist/preload.cjs',
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  }),
  build({
    ...common,
    entryPoints: ['src/renderer/app.ts'],
    outfile: 'dist/renderer/app.js',
    platform: 'browser',
    format: 'iife',
    target: 'chrome120',
  }),
])
cpSync('src/renderer/index.html', 'dist/renderer/index.html')
