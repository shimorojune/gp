import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync } from 'node:fs'
import { build } from 'esbuild'

// GP_VERSION: the updater end-to-end test builds throwaway prerelease versions.
const version = process.env.GP_VERSION ?? JSON.parse(readFileSync('package.json', 'utf8')).version
function commit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}
// Shown in the dashboard and overlay, and what the updater will compare against.
const define = {
  __GP_VERSION__: JSON.stringify(version),
  __GP_COMMIT__: JSON.stringify(commit()),
}

mkdirSync('dist', { recursive: true })
const common = { bundle: true, sourcemap: true, logLevel: 'info', target: 'node20', define }

await Promise.all([
  build({
    ...common,
    entryPoints: ['src/main/main.ts'],
    outfile: 'dist/main.cjs',
    platform: 'node',
    format: 'cjs',
    // The SDK locates its native Claude Code binary relative to its own package; don't bundle it.
    external: ['electron', '@anthropic-ai/claude-agent-sdk', 'node-hid'],
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
    entryPoints: ['src/renderer/chat.ts'],
    outfile: 'dist/renderer/chat.js',
    platform: 'browser',
    format: 'iife',
    target: 'chrome120',
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
cpSync('src/renderer/chat.html', 'dist/renderer/chat.html')
