// Build GP.app (arm64) as a zip (updates) and a dmg (first install), then smoke-test it.
//
//   pnpm package               from the repo root, on a Mac
//   GP_SKIP_SMOKE=1 pnpm package   skip the launch check
//
// Output in apps/desktop/release/: GP-<version>-arm64.zip, GP-<version>-arm64.dmg and
// gp-release.json. Unsigned (ad-hoc signed): after downloading, run `xattr -cr /Applications/GP.app`.
//
// main.cjs bundles every @gp/* package, so the app only needs the few modules esbuild leaves
// external (Agent SDK + its native Claude Code binary, node-hid). They're installed with npm into
// a flat staging folder, because electron-builder doesn't cope well with pnpm's symlinked
// node_modules.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Arch, Platform, build } from 'electron-builder'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const stage = join(root, '.stage')
const out = join(root, 'release')
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const pkg = readJson(join(root, 'package.json'))
const { version } = pkg
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts })

/** Version of a dependency as pnpm installed it for apps/desktop (or next to `from`). */
function installed(name, from = join(root, 'node_modules')) {
  return readJson(join(from, name, 'package.json')).version
}

// 1. Bundle main, preload and renderers into dist/.
run(process.execPath, ['build.mjs'], { cwd: root })

// 2. Staging app: dist + a package.json with just the runtime externals, pinned to what pnpm has.
rmSync(stage, { recursive: true, force: true })
rmSync(out, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
cpSync(join(root, 'dist'), join(stage, 'dist'), { recursive: true })
const SDK = '@anthropic-ai/claude-agent-sdk'
const sdkDir = realpathSync(join(root, 'node_modules', SDK))
// The SDK's peers sit next to it in pnpm's store: <store>/node_modules/{@anthropic-ai/sdk,zod,...}
const sdkSiblings = join(sdkDir, '..', '..')
const sdkPeers = Object.keys(readJson(join(sdkDir, 'package.json')).peerDependencies ?? {})
const dependencies = {
  [SDK]: installed(SDK),
  'node-hid': installed('node-hid'),
  ...Object.fromEntries(sdkPeers.map((p) => [p, installed(p, sdkSiblings)])),
}
writeFileSync(
  join(stage, 'package.json'),
  `${JSON.stringify(
    {
      name: 'gp',
      productName: 'GP',
      version,
      description: pkg.description,
      author: 'shimorojune',
      repository: 'github:shimorojune/gp',
      main: 'dist/main.cjs',
      dependencies,
    },
    null,
    2,
  )}\n`,
)
console.log('[package] runtime dependencies', dependencies)
// --os/--cpu: the Agent SDK's native binary is an optional per-platform package; always take the
// darwin-arm64 one. --ignore-scripts: node-hid ships N-API prebuilds (ABI-stable, no rebuild
// for Electron needed); its install script would only fall back to node-gyp.
run(
  'npm',
  [
    'install',
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    '--no-package-lock',
    '--ignore-scripts',
    '--os=darwin',
    '--cpu=arm64',
  ],
  { cwd: stage },
)
const claudeBin = join(stage, 'node_modules', `${SDK}-darwin-arm64`, 'claude')
if (!existsSync(claudeBin)) throw new Error(`no darwin-arm64 Claude Code binary at ${claudeBin}`)
const hid = join(stage, 'node_modules', 'node-hid')
if (!existsSync(join(hid, 'prebuilds', 'HID-darwin-arm64')))
  throw new Error('node-hid has no darwin-arm64 prebuild')
// Only the darwin-arm64 addon is needed; drop the C sources and other platforms' builds.
for (const d of readdirSync(join(hid, 'prebuilds')))
  if (d !== 'HID-darwin-arm64') rmSync(join(hid, 'prebuilds', d), { recursive: true })
for (const d of ['hidapi', 'src']) rmSync(join(hid, d), { recursive: true, force: true })

// 3. electron-builder.
await build({
  projectDir: stage,
  targets: Platform.MAC.createTarget(['zip', 'dmg'], Arch.arm64),
  publish: 'never',
  config: {
    // Updates come from GitHub Releases through GP's own updater, not electron-updater.
    publish: null,
    appId: 'io.github.shimorojune.gp',
    productName: 'GP',
    electronVersion: installed('electron'),
    directories: { output: out },
    files: ['dist/**/*', 'package.json', '!**/*.map'],
    asar: true,
    // Executables and native addons can't run from inside app.asar.
    asarUnpack: [`node_modules/${SDK}-darwin-arm64/**`, 'node_modules/node-hid/**'],
    npmRebuild: false,
    nodeGypRebuild: false,
    artifactName: 'GP-${version}-${arch}.${ext}',
    mac: {
      category: 'public.app-category.sports',
      // No Apple Developer account: skip real signing, ad-hoc sign in afterPack instead.
      identity: null,
      hardenedRuntime: false,
      gatekeeperAssess: false,
      minimumSystemVersion: '13.0',
      // Generated by scripts/make-icon.mjs from build/icon/icon.svg.
      icon: join(root, 'build', 'icon.icns'),
      extendInfo: {
        // ffmpeg records the DualSense mic as a child of GP.app; macOS asks once.
        NSMicrophoneUsageDescription: 'GP listens to your push-to-talk radio messages.',
      },
    },
    dmg: { writeUpdateInfo: false, icon: join(root, 'build', 'icon.icns') },
    afterPack: join(root, 'scripts', 'after-pack.cjs'),
  },
})

// 4. Manifest for the updater: exact names, sizes and hashes of what's attached to the release.
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const files = readdirSync(out).filter((f) => /^GP-.*-arm64\.(zip|dmg)$/.test(f))
const commit = (
  process.env.GITHUB_SHA ??
  spawnSync('git', ['rev-parse', 'HEAD']).stdout?.toString() ??
  ''
).trim()
const manifest = {
  name: 'GP',
  version,
  commit,
  arch: 'arm64',
  builtAt: new Date().toISOString(),
  files: Object.fromEntries(
    files.map((f) => [
      f.endsWith('.zip') ? 'zip' : 'dmg',
      { name: f, size: statSync(join(out, f)).size, sha256: sha256(join(out, f)) },
    ]),
  ),
}
writeFileSync(join(out, 'gp-release.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log('[package] gp-release.json', manifest)

// 5. Smoke test the app the way the updater will install it: unzip with ditto, launch, check.
if (process.platform === 'darwin' && process.env.GP_SKIP_SMOKE !== '1') {
  const zip = join(out, manifest.files.zip.name)
  const dir = mkdtempSync(join(tmpdir(), 'gp-smoke-'))
  run('ditto', ['-x', '-k', zip, dir])
  const app = join(dir, 'GP.app')
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
  const home = mkdtempSync(join(tmpdir(), 'gp-home-'))
  const r = spawnSync(join(app, 'Contents', 'MacOS', 'GP'), ['--smoke-test'], {
    encoding: 'utf8',
    timeout: 120_000,
    // Its own data folder and UDP port, so a running GP on this Mac isn't touched.
    env: { ...process.env, GP_HOME: home, GP_UDP_PORT: '20799' },
  })
  const line = `${r.stdout}`.split('\n').find((l) => l.startsWith('GP_SMOKE '))
  if (!line) {
    console.error(r.stdout, r.stderr, r.error)
    throw new Error(`smoke test printed no result (exit ${r.status})`)
  }
  const result = JSON.parse(line.slice('GP_SMOKE '.length))
  console.log('[package] smoke test', result)
  if (!result.ok || r.status !== 0)
    throw new Error(`smoke test failed: ${result.errors.join('; ')}`)
  rmSync(dir, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
}
console.log(`[package] done: ${files.join(', ')}`)
