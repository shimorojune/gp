import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Secrets come from Infisical (docs: infisical.com/docs, Universal Auth machine identity).
 * The Mac keeps only how to reach Infisical, plus the last secrets it fetched so GP still
 * talks in a race when Infisical is unreachable. Both files are encrypted with the macOS
 * Keychain (Electron safeStorage), never plain text. ~/Documents/GP/.env still loads first
 * as a testing override; whatever Infisical returns wins.
 */

/** What GP expects to find in Infisical. Shown as found or missing, never their values. */
export const EXPECTED_SECRETS = [
  'DATABASE_URL',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ELEVENLABS_API_KEY',
  'DEEPGRAM_API_KEY',
] as const

/** Only these names are copied into the environment: the expected ones and GP_* settings. */
export const secretAllowed = (name: string) =>
  (EXPECTED_SECRETS as readonly string[]).includes(name) || /^GP_[A-Z0-9_]+$/.test(name)

export const DEFAULT_SITE = 'https://app.infisical.com'

export interface InfisicalConfig {
  siteUrl: string
  clientId: string
  clientSecret: string
  projectId: string
  environment: string
  secretPath: string
}

/** The config as the settings pane sees it: everything except the client secret. */
export type PublicInfisicalConfig = Omit<InfisicalConfig, 'clientSecret'> & { hasSecret: boolean }

export interface SecretsStatus {
  configured: boolean
  /** Where the secrets in use came from this run. */
  source: 'infisical' | 'cache' | 'none'
  /** When they were fetched from Infisical (ISO), for 'infisical' and 'cache'. */
  fetchedAt: string | null
  /** The last fetch's error, if it failed. */
  error: string | null
  found: Record<string, boolean>
  config: PublicInfisicalConfig | null
}

/** Encryption at rest (Electron safeStorage in the app; a stand-in in tests). */
export interface SecretCrypto {
  available(): boolean
  encrypt(text: string): Buffer
  decrypt(data: Buffer): string
}

type Fetch = typeof fetch

const trimSlash = (s: string) => s.replace(/\/+$/, '')

/** Log in with the machine identity and read every secret at the path (imports included). */
export async function fetchInfisical(
  cfg: InfisicalConfig,
  fetchImpl: Fetch = fetch,
  timeoutMs = 8000,
): Promise<Record<string, string>> {
  const site = trimSlash(cfg.siteUrl || DEFAULT_SITE)
  const signal = AbortSignal.timeout(timeoutMs)
  const call = async (path: string, init: RequestInit) => {
    let res: Response
    try {
      res = await fetchImpl(`${site}${path}`, { ...init, signal })
    } catch (e) {
      const why =
        e instanceof Error ? (e.name === 'TimeoutError' ? 'timed out' : e.message) : String(e)
      throw new Error(`Can't reach ${site}: ${why}`)
    }
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok) {
      const msg = typeof body?.message === 'string' ? body.message : res.statusText
      throw new Error(`Infisical ${res.status}: ${msg}`)
    }
    return body ?? {}
  }

  const login = await call('/api/v1/auth/universal-auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId: cfg.clientId, clientSecret: cfg.clientSecret }),
  })
  const token = login.accessToken
  if (typeof token !== 'string') throw new Error('Infisical login returned no access token')

  const q = new URLSearchParams({
    projectId: cfg.projectId,
    environment: cfg.environment,
    secretPath: cfg.secretPath || '/',
    viewSecretValue: 'true',
    expandSecretReferences: 'true',
    includeImports: 'true',
  })
  const list = await call(`/api/v4/secrets?${q}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  type Raw = { secretKey?: unknown; secretValue?: unknown }
  const out: Record<string, string> = {}
  const take = (xs: unknown) => {
    if (!Array.isArray(xs)) return
    for (const s of xs as Raw[])
      if (typeof s.secretKey === 'string' && typeof s.secretValue === 'string')
        out[s.secretKey] = s.secretValue
  }
  // Imported folders first, so the path's own secrets win.
  if (Array.isArray(list.imports))
    for (const i of list.imports) take((i as { secrets?: unknown }).secrets)
  take(list.secrets)
  return out
}

/** Copy allowed secrets into the environment. Returns the names set. */
export function applySecrets(values: Record<string, string>, env: NodeJS.ProcessEnv = process.env) {
  const set: string[] = []
  for (const [k, v] of Object.entries(values)) {
    if (!secretAllowed(k) || !v) continue
    env[k] = v
    set.push(k)
  }
  return set
}

export class SecretStore {
  private readonly configFile: string
  private readonly cacheFile: string
  private state: SecretsStatus

  constructor(
    dir: string,
    private readonly crypto: SecretCrypto,
    private readonly fetchImpl: Fetch = fetch,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    this.configFile = join(dir, 'infisical.enc')
    this.cacheFile = join(dir, 'secrets-cache.enc')
    mkdirSync(dir, { recursive: true })
    this.state = this.blank()
  }

  private blank(): SecretsStatus {
    const config = this.publicConfig()
    return {
      configured: !!config,
      source: 'none',
      fetchedAt: null,
      error: null,
      found: this.found(),
      config,
    }
  }

  private found(): Record<string, boolean> {
    return Object.fromEntries(EXPECTED_SECRETS.map((k) => [k, !!this.env[k]]))
  }

  private read<T>(file: string): T | null {
    if (!existsSync(file) || !this.crypto.available()) return null
    try {
      return JSON.parse(this.crypto.decrypt(readFileSync(file))) as T
    } catch {
      return null
    }
  }

  private write(file: string, value: unknown): void {
    if (!this.crypto.available()) throw new Error('Keychain encryption is not available')
    writeFileSync(file, this.crypto.encrypt(JSON.stringify(value)), { mode: 0o600 })
  }

  private loadConfig(): InfisicalConfig | null {
    return this.read<InfisicalConfig>(this.configFile)
  }

  publicConfig(): PublicInfisicalConfig | null {
    const c = this.loadConfig()
    if (!c) return null
    const { clientSecret, ...rest } = c
    return { ...rest, hasSecret: !!clientSecret }
  }

  status(): SecretsStatus {
    const config = this.publicConfig()
    return { ...this.state, configured: !!config, found: this.found(), config }
  }

  /**
   * Save the connection. An empty client secret keeps the saved one, so the pane never has to
   * show it again.
   */
  saveConfig(input: Omit<InfisicalConfig, 'clientSecret'> & { clientSecret?: string }): void {
    const old = this.loadConfig()
    const cfg = normalise({ ...input, clientSecret: input.clientSecret || old?.clientSecret || '' })
    const missing = (['clientId', 'clientSecret', 'projectId', 'environment'] as const).filter(
      (k) => !cfg[k],
    )
    if (missing.length) throw new Error(`Missing ${missing.join(', ')}`)
    this.write(this.configFile, cfg)
  }

  /** Forget the connection and the cached secrets. */
  clear(): void {
    rmSync(this.configFile, { force: true })
    rmSync(this.cacheFile, { force: true })
    this.state = this.blank()
  }

  /**
   * Try a connection without saving it: which expected secrets it has, or why it failed.
   * An empty client secret uses the saved one.
   */
  async test(
    input: Omit<InfisicalConfig, 'clientSecret'> & { clientSecret?: string },
  ): Promise<{ found: Record<string, boolean>; count: number } | { error: string }> {
    const cfg = normalise({
      ...input,
      clientSecret: input.clientSecret || this.loadConfig()?.clientSecret || '',
    })
    try {
      const values = await fetchInfisical(cfg, this.fetchImpl)
      return {
        found: Object.fromEntries(EXPECTED_SECRETS.map((k) => [k, !!values[k]])),
        count: Object.keys(values).length,
      }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * Fetch from Infisical and put the secrets in the environment. On failure, use the last
   * secrets fetched (encrypted on disk). Never throws.
   */
  async refresh(): Promise<SecretsStatus> {
    const cfg = this.loadConfig()
    if (!cfg) {
      this.state = this.blank()
      return this.status()
    }
    try {
      const values = await fetchInfisical(cfg, this.fetchImpl)
      const fetchedAt = new Date().toISOString()
      applySecrets(values, this.env)
      try {
        this.write(this.cacheFile, { fetchedAt, values })
      } catch {}
      this.state = { ...this.blank(), source: 'infisical', fetchedAt }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      const cache = this.read<{ fetchedAt: string; values: Record<string, string> }>(this.cacheFile)
      if (cache) applySecrets(cache.values, this.env)
      this.state = {
        ...this.blank(),
        source: cache ? 'cache' : 'none',
        fetchedAt: cache?.fetchedAt ?? null,
        error,
      }
    }
    return this.status()
  }
}

function normalise(c: InfisicalConfig): InfisicalConfig {
  const path = (c.secretPath || '/').trim()
  return {
    siteUrl: trimSlash((c.siteUrl || DEFAULT_SITE).trim()),
    clientId: c.clientId.trim(),
    clientSecret: c.clientSecret.trim(),
    projectId: c.projectId.trim(),
    environment: c.environment.trim(),
    secretPath: path.startsWith('/') ? path : `/${path}`,
  }
}
