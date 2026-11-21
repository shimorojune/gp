// End-to-end test of the self-updater, on a Mac (CI runs it on claude/** branch builds):
//
//   1. build two throwaway versions, A (<v>-e2e.1) and B (<v>-e2e.2)
//   2. "install" A into a temp Applications folder, serve B's zip + gp-release.json over HTTP
//   3. update: launch A pointed at that feed; it must download B, check it, quit, get swapped
//      for B by the helper script, and B must report healthy. A is kept as the backup.
//   4. rollback: reinstall A, make B "fail to start" (GP_E2E_SKIP_HEALTH); the helper must put
//      A back, relaunch it, and A must record B as failed.
//
//   node apps/desktop/scripts/e2e-update.mjs
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') {
  console.log('[e2e-update] macOS only, skipped')
  process.exit(0)
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version.split('-')[0]
const A = `${base}-e2e.1`
const B = `${base}-e2e.2`
// realpath: /var is a symlink to /private/var, and pkill matches the real path.
const work = realpathSync(mkdtempSync(join(tmpdir(), 'gp-e2e-')))
const run = (cmd, args, env = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const plistVersion = (app) =>
  execFileSync(
    'plutil',
    ['-extract', 'CFBundleShortVersionString', 'raw', join(app, 'Contents', 'Info.plist')],
    {
      encoding: 'utf8',
    },
  ).trim()

// 1. Two builds. The smoke test already ran in the normal package step; skip it here.
for (const v of [A, B])
  run(process.execPath, [join(root, 'scripts', 'package.mjs')], {
    GP_VERSION: v,
    GP_RELEASE_DIR: join(work, `build-${v}`),
    GP_SKIP_SMOKE: '1',
  })

// 2. Feed: B's release folder over HTTP.
const port = 18000 + Math.floor(Math.random() * 1000)
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
  cwd: join(work, `build-${B}`),
  stdio: 'ignore',
})
const feed = `http://127.0.0.1:${port}/gp-release.json`
const apps = join(work, 'Applications')
const installed = join(apps, 'GP.app')
const killAll = () => {
  try {
    execFileSync('pkill', ['-f', `${installed}/Contents/`])
  } catch {}
}

function installA() {
  killAll()
  rmSync(apps, { recursive: true, force: true })
  mkdirSync(apps, { recursive: true })
  run('ditto', ['-x', '-k', join(work, `build-${A}`, `GP-${A}-arm64.zip`), apps])
  if (plistVersion(installed) !== A) throw new Error('A did not install')
}

async function waitFor(what, fn, timeoutMs) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (fn()) return
    await sleep(2000)
  }
  throw new Error(`timed out waiting for: ${what}`)
}

function launchA(home, extra = []) {
  run('open', [
    '-n',
    '--env',
    `GP_HOME=${home}`,
    '--env',
    `GP_UPDATE_FEED=${feed}`,
    '--env',
    'GP_UPDATE_AUTO_INSTALL=1',
    '--env',
    'GP_UPDATE_FIRST_CHECK_MS=3000',
    '--env',
    'GP_UDP_PORT=20797',
    ...extra.flatMap((e) => ['--env', e]),
    installed,
  ])
}

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8').trim() : '')
const showLog = (home) => {
  console.log(`--- update.log ---\n${read(join(home, 'updates', 'update.log'))}`)
  console.log(
    `--- gp.log (tail) ---\n${read(join(home, 'logs', 'gp.log'))
      .split('\n')
      .slice(-40)
      .join('\n')}`,
  )
}

let ok = false
try {
  // 3. Update A -> B.
  installA()
  const home1 = join(work, 'home-update')
  launchA(home1)
  try {
    await waitFor(
      `B (${B}) reporting healthy`,
      () => read(join(home1, 'updates', 'boot-ok')) === B,
      6 * 60_000,
    )
    await waitFor(
      'helper finishing',
      () => read(join(home1, 'updates', 'update.log')).includes('is up'),
      30_000,
    )
  } catch (e) {
    showLog(home1)
    throw e
  }
  if (plistVersion(installed) !== B)
    throw new Error(`installed app is ${plistVersion(installed)}, expected ${B}`)
  const backup = join(home1, 'updates', 'GP-previous.app')
  if (plistVersion(backup) !== A) throw new Error('backup is not A')
  console.log(`[e2e-update] update OK: ${A} -> ${B}, backup kept`)
  showLog(home1)

  // 4. Rollback: B "never comes up".
  installA()
  const home2 = join(work, 'home-rollback')
  launchA(home2, ['GP_E2E_SKIP_HEALTH=1', 'GP_UPDATE_HEALTH_WAIT=25'])
  try {
    await waitFor(
      'rollback',
      () => read(join(home2, 'updates', 'update.log')).includes('restored the previous GP'),
      6 * 60_000,
    )
    // The relaunched A reads rolled-back and records B as failed.
    await waitFor(
      'A recording B as failed',
      () => read(join(home2, 'updates', 'failed.json')).includes(B),
      60_000,
    )
  } catch (e) {
    showLog(home2)
    throw e
  }
  if (plistVersion(installed) !== A)
    throw new Error(`after rollback the app is ${plistVersion(installed)}`)
  console.log(`[e2e-update] rollback OK: ${B} failed to start, ${A} restored and running`)
  showLog(home2)
  ok = true
} finally {
  killAll()
  server.kill()
  if (ok) rmSync(work, { recursive: true, force: true })
}
