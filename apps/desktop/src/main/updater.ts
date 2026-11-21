import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { UpdateState } from '../ipc.ts'
import { UPDATE_HELPER } from './update-helper.ts'

/**
 * GP's own updater. electron-updater can't be used: Squirrel.Mac only installs updates signed
 * with a real Developer ID, and GP is ad-hoc signed. So:
 *
 *   check     GitHub releases/latest (public repo, no token) -> gp-release.json
 *   download  GP-<v>-arm64.zip into <GP home>/updates, size + sha256 from the manifest
 *   prepare   ditto -x -k, xattr -cr, codesign --verify, version check, and a --smoke-test
 *             launch of the new copy (own data folder and UDP port, the running GP untouched)
 *   install   only on request and only while no telemetry is coming in: a detached helper
 *             script swaps the .app after GP quits, keeps the old one as a backup, and rolls
 *             back if the new one doesn't report healthy (see update-helper.ts)
 *
 * Downloads and installs never happen while the game is sending telemetry.
 */

export const GITHUB_FEED = 'https://api.github.com/repos/shimorojune/gp/releases/latest'

export interface ReleaseManifest {
  name: string
  version: string
  commit: string
  arch: string
  files: { zip: { name: string; size: number; sha256: string }; dmg?: unknown }
}

/** -1, 0 or 1. Plain x.y.z with an optional -prerelease (a prerelease sorts before its release). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = '', pre = ''] = v.replace(/^v/, '').split('-', 2)
    return { nums: core.split('.').map((n) => Number(n) || 0), pre }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d) return Math.sign(d)
  }
  if (x.pre === y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  return x.pre < y.pre ? -1 : 1
}

export function parseManifest(raw: unknown): ReleaseManifest {
  const m = raw as Partial<ReleaseManifest>
  const zip = m?.files?.zip
  if (
    typeof m?.version !== 'string' ||
    !zip ||
    typeof zip.name !== 'string' ||
    typeof zip.size !== 'number' ||
    !/^[0-9a-f]{64}$/.test(String(zip.sha256))
  )
    throw new Error('gp-release.json is missing version or zip details')
  if (m.arch && m.arch !== process.arch) throw new Error(`release is for ${m.arch}`)
  if (/[/\\]/.test(zip.name)) throw new Error('bad zip name in gp-release.json')
  return m as ReleaseManifest
}

/** Why this copy can't update itself, or null if it can. */
export function notUpdatableReason(appPath: string | null, packaged: boolean): string | null {
  if (!packaged) return 'running from the repo'
  if (!appPath?.endsWith('.app')) return 'not running from GP.app'
  if (appPath.startsWith('/Volumes/')) return 'running from the disk image: drag GP to Applications'
  if (appPath.includes('/AppTranslocation/'))
    return 'macOS is running GP from a quarantine copy: run xattr -cr /Applications/GP.app'
  return null
}

const exec = (cmd: string, args: string[], timeout = 120_000) =>
  new Promise<string>((resolve, reject) =>
    execFile(cmd, args, { timeout, encoding: 'utf8' }, (err, stdout, stderr) =>
      err
        ? reject(new Error(`${cmd} failed: ${(stderr || err.message).trim().slice(-300)}`))
        : resolve(stdout),
    ),
  )

export interface UpdaterOptions {
  currentVersion: string
  /** The installed GP.app, or null when not packaged. */
  appPath: string | null
  packaged: boolean
  /** <GP home>/updates */
  dir: string
  /** GitHub API releases/latest URL, or the URL of a gp-release.json (zip next to it). */
  feed?: string
  /** True when no telemetry has come in for a while (not driving, game not sending). */
  isIdle: () => boolean
  onState: (s: UpdateState) => void
  log: (line: string) => void
}

interface Found {
  manifest: ReleaseManifest
  zipUrl: string
  notes: string | null
}

export class Updater {
  private s: UpdateState
  private busy = false
  private found: Found | null = null
  private stagedApp: string | null = null
  private timer: NodeJS.Timeout | null = null
  private readonly feed: string

  constructor(private readonly o: UpdaterOptions) {
    this.feed = o.feed ?? GITHUB_FEED
    const why = notUpdatableReason(o.appPath, o.packaged)
    this.s = why
      ? { phase: 'disabled', current: o.currentVersion, message: why }
      : { phase: 'idle', current: o.currentVersion }
  }

  get state(): UpdateState {
    return this.s
  }

  private set(patch: Partial<UpdateState> & Pick<UpdateState, 'phase'>): void {
    this.s = { current: this.o.currentVersion, ...patch }
    this.o.onState(this.s)
  }

  /**
   * Called once at startup: finishes a pending update (health report or rollback notice), then
   * checks now-ish and every few hours.
   */
  async start(firstCheckMs = 30_000, everyMs = 4 * 3600_000): Promise<void> {
    await this.afterLaunch()
    if (this.s.phase === 'disabled') return
    setTimeout(() => void this.check(), firstCheckMs).unref()
    this.timer = setInterval(() => void this.check(), everyMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  /** Look for a new release; download and prepare it when idle. `manual`: the button. */
  async check(manual = false): Promise<UpdateState> {
    if (this.s.phase === 'disabled' || this.busy) return this.s
    if (this.s.phase === 'ready') return this.s
    if (!this.o.isIdle()) {
      if (manual)
        this.set({
          ...this.s,
          phase: this.s.phase,
          message: 'Not while the game is sending telemetry',
        })
      this.retryLater()
      return this.s
    }
    this.busy = true
    try {
      this.set({ phase: 'checking' })
      const found = await this.fetchLatest()
      const failed = await this.failedVersions()
      const v = found.manifest.version
      if (compareVersions(v, this.o.currentVersion) <= 0) {
        this.set({ phase: 'up-to-date', checkedAt: new Date().toISOString() })
        return this.s
      }
      if (failed.includes(v) && !manual) {
        this.set({
          phase: 'error',
          version: v,
          message: `v${v} failed to start before; press Check to retry`,
        })
        return this.s
      }
      this.found = found
      this.o.log(`[update] v${v} available (running v${this.o.currentVersion})`)
      await this.prepare(found)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      this.o.log(`[update] ${message}`)
      this.set({
        phase: 'error',
        ...(this.found ? { version: this.found.manifest.version } : {}),
        message,
      })
    } finally {
      this.busy = false
    }
    return this.s
  }

  private retryLater(): void {
    setTimeout(() => void this.check(), 5 * 60_000).unref()
  }

  private async fetchJson(url: string): Promise<unknown> {
    const r = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'gp-updater' },
    })
    if (!r.ok) throw new Error(`update check: ${url} answered ${r.status}`)
    return r.json()
  }

  private async fetchLatest(): Promise<Found> {
    if (!this.feed.includes('api.github.com')) {
      const manifest = parseManifest(await this.fetchJson(this.feed))
      return { manifest, zipUrl: new URL(manifest.files.zip.name, this.feed).href, notes: null }
    }
    const rel = (await this.fetchJson(this.feed)) as {
      body?: string
      assets?: { name: string; browser_download_url: string }[]
    }
    const asset = (name: string) => rel.assets?.find((a) => a.name === name)?.browser_download_url
    const manifestUrl = asset('gp-release.json')
    if (!manifestUrl) throw new Error('latest release has no gp-release.json')
    const manifest = parseManifest(await this.fetchJson(manifestUrl))
    const zipUrl = asset(manifest.files.zip.name)
    if (!zipUrl) throw new Error(`latest release has no ${manifest.files.zip.name}`)
    return { manifest, zipUrl, notes: rel.body ?? null }
  }

  private async prepare({ manifest, zipUrl, notes }: Found): Promise<void> {
    const v = manifest.version
    const { size, sha256, name } = manifest.files.zip
    await mkdir(this.o.dir, { recursive: true })
    const zip = join(this.o.dir, name)

    // Download, unless an earlier run already got this exact file.
    let have = false
    try {
      have = (await stat(zip)).size === size && (await sha256File(zip)) === sha256
    } catch {}
    if (!have) {
      this.set({ phase: 'downloading', version: v, progress: 0 })
      const r = await fetch(zipUrl, { headers: { 'User-Agent': 'gp-updater' } })
      if (!r.ok || !r.body) throw new Error(`download answered ${r.status}`)
      const part = `${zip}.part`
      const hash = createHash('sha256')
      let got = 0
      let lastPct = -1
      const body = Readable.fromWeb(r.body as never)
      body.on('data', (chunk: Buffer) => {
        hash.update(chunk)
        got += chunk.length
        const pct = Math.floor((got / size) * 100)
        if (pct !== lastPct && pct % 5 === 0) {
          lastPct = pct
          this.set({ phase: 'downloading', version: v, progress: pct })
        }
      })
      await pipeline(body, createWriteStream(part))
      if (got !== size) throw new Error(`download was ${got} bytes, expected ${size}`)
      if (hash.digest('hex') !== sha256) throw new Error('download failed its sha256 check')
      await rename(part, zip)
    }

    // Unpack the way the release CI tested it, then check it before trusting it.
    this.set({ phase: 'verifying', version: v })
    const staged = join(this.o.dir, 'staged')
    await rm(staged, { recursive: true, force: true })
    await mkdir(staged, { recursive: true })
    await exec('ditto', ['-x', '-k', zip, staged])
    const app = join(staged, 'GP.app')
    await exec('xattr', ['-cr', app])
    await exec('codesign', ['--verify', '--deep', '--strict', app])
    const plistVersion = (
      await exec('plutil', [
        '-extract',
        'CFBundleShortVersionString',
        'raw',
        join(app, 'Contents', 'Info.plist'),
      ])
    ).trim()
    if (plistVersion !== v) throw new Error(`zip contains v${plistVersion}, expected v${v}`)
    await smokeTest(app)

    this.stagedApp = app
    this.o.log(`[update] v${v} downloaded and checked, ready to install`)
    this.set({ phase: 'ready', version: v, ...(notes ? { notes } : {}) })
  }

  /**
   * Quit-and-swap. Returns an error message instead when it can't go ahead (the caller quits the
   * app on success).
   */
  async install(pid: number): Promise<string | null> {
    if (this.s.phase !== 'ready' || !this.stagedApp || !this.found || !this.o.appPath)
      return 'No update is ready'
    if (!this.o.isIdle())
      return 'Not while the game is sending telemetry. Try again after the session.'
    const v = this.found.manifest.version
    const script = join(this.o.dir, 'apply-update.sh')
    await writeFile(script, UPDATE_HELPER, { mode: 0o755 })
    await writeFile(
      join(this.o.dir, 'pending.json'),
      JSON.stringify({ from: this.o.currentVersion, to: v, at: new Date().toISOString() }),
    )
    await rm(join(this.o.dir, 'rolled-back'), { force: true })
    const backup = join(this.o.dir, 'GP-previous.app')
    this.o.log(
      `[update] installing v${v}: GP quits, the helper swaps ${this.o.appPath} and relaunches`,
    )
    spawn(
      '/bin/bash',
      [script, String(pid), this.o.appPath, this.stagedApp, backup, this.o.dir, v],
      {
        detached: true,
        stdio: 'ignore',
      },
    ).unref()
    this.set({ phase: 'installing', version: v })
    return null
  }

  /** First launch after an install: report healthy (new version) or record a rollback (old). */
  private async afterLaunch(): Promise<void> {
    const dir = this.o.dir
    const pending = await readJson<{ from: string; to: string }>(join(dir, 'pending.json'))
    const rolledBack = (await readFile(join(dir, 'rolled-back'), 'utf8').catch(() => '')).trim()
    if (rolledBack) {
      await this.markFailed(rolledBack)
      await rm(join(dir, 'rolled-back'), { force: true })
      await rm(join(dir, 'pending.json'), { force: true })
      this.o.log(`[update] v${rolledBack} didn't start, rolled back to v${this.o.currentVersion}`)
      if (this.s.phase !== 'disabled')
        this.set({
          phase: 'error',
          version: rolledBack,
          message: `v${rolledBack} didn't start, so GP went back to v${this.o.currentVersion}. See ~/Documents/GP/updates/update.log`,
        })
      return
    }
    if (pending && pending.to === this.o.currentVersion) this.justUpdatedFrom = pending.from
  }

  private justUpdatedFrom: string | null = null

  /**
   * Called by main once the windows have loaded and the app has run for a few seconds: tells the
   * helper script this version is healthy, so it doesn't roll back.
   */
  async reportHealthy(): Promise<void> {
    const from = this.justUpdatedFrom
    if (!from) return
    this.justUpdatedFrom = null
    await writeFile(join(this.o.dir, 'boot-ok'), this.o.currentVersion)
    await rm(join(this.o.dir, 'pending.json'), { force: true })
    // The zip and staging folder have done their job; the backup stays for a manual rollback.
    await rm(join(this.o.dir, 'staged'), { recursive: true, force: true })
    await removeZips(this.o.dir)
    this.o.log(`[update] updated v${from} -> v${this.o.currentVersion}`)
    this.set({
      phase: 'up-to-date',
      message: `Updated from v${from}`,
      checkedAt: new Date().toISOString(),
    })
  }

  private async failedVersions(): Promise<string[]> {
    return (await readJson<string[]>(join(this.o.dir, 'failed.json'))) ?? []
  }

  private async markFailed(v: string): Promise<void> {
    const list = [...new Set([...(await this.failedVersions()), v])]
    await writeFile(join(this.o.dir, 'failed.json'), JSON.stringify(list))
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  const { createReadStream } = await import('node:fs')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

async function removeZips(dir: string): Promise<void> {
  const { readdir } = await import('node:fs/promises')
  for (const f of await readdir(dir).catch(() => [] as string[]))
    if (/^GP-.*\.zip(\.part)?$/.test(f)) await rm(join(dir, f), { force: true })
}

/**
 * Launch the new copy in its packaging self-check mode, with its own data folder and UDP port and
 * no single-instance clash with the running GP.
 */
async function smokeTest(app: string): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'gp-update-check-'))
  try {
    const out = await new Promise<string>((resolve, reject) =>
      execFile(
        join(app, 'Contents', 'MacOS', 'GP'),
        ['--smoke-test'],
        {
          timeout: 120_000,
          encoding: 'utf8',
          env: {
            ...process.env,
            GP_HOME: home,
            GP_UDP_PORT: '20798',
            GP_SMOKE_BESIDE_RUNNING: '1',
          },
        },
        (err, stdout) => {
          const line = stdout.split('\n').find((l) => l.startsWith('GP_SMOKE '))
          if (line) resolve(line)
          else reject(new Error(`new version didn't start: ${err?.message ?? 'no result'}`))
        },
      ),
    )
    const r = JSON.parse(out.slice('GP_SMOKE '.length)) as { ok: boolean; errors: string[] }
    if (!r.ok) throw new Error(`new version failed its self-check: ${r.errors.join('; ')}`)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}
