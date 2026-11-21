import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type SecretCrypto,
  SecretStore,
  applySecrets,
  fetchInfisical,
  scrubSecrets,
} from './secrets.ts'

const crypto: SecretCrypto = {
  available: () => true,
  encrypt: (t) => Buffer.from(Buffer.from(t).toString('base64').split('').reverse().join('')),
  decrypt: (b) => Buffer.from(b.toString().split('').reverse().join(''), 'base64').toString(),
}

const cfg = {
  siteUrl: 'https://vault.example.com/',
  clientId: 'id-1',
  clientSecret: 'shh',
  projectId: 'proj',
  environment: 'prod',
  secretPath: 'gp',
}

type Call = { url: string; init?: RequestInit }
function fakeInfisical(
  secrets: Record<string, string>,
  opts: { down?: boolean; badLogin?: boolean; noImports?: boolean } = {},
) {
  const calls: Call[] = []
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (opts.down) throw new TypeError('fetch failed')
    if (url.endsWith('/api/v1/auth/universal-auth/login')) {
      if (opts.badLogin) return Response.json({ message: 'Invalid credentials' }, { status: 401 })
      return Response.json({ accessToken: 'tok', expiresIn: 7200 })
    }
    if (url.includes('/api/v4/secrets?')) {
      if ((init?.headers as Record<string, string>)?.authorization !== 'Bearer tok')
        return Response.json({ message: 'no' }, { status: 401 })
      return Response.json({
        secrets: Object.entries(secrets).map(([secretKey, secretValue]) => ({
          secretKey,
          secretValue,
        })),
        imports: opts.noImports
          ? []
          : [{ secrets: [{ secretKey: 'DEEPGRAM_API_KEY', secretValue: 'from-import' }] }],
      })
    }
    return new Response('not found', { status: 404 })
  }) as unknown as typeof fetch
  return { f, calls }
}

describe('fetchInfisical', () => {
  it('logs in, then lists the path with imports; the path wins over imports', async () => {
    const { f, calls } = fakeInfisical({ DATABASE_URL: 'postgres://x', DEEPGRAM_API_KEY: 'own' })
    const out = await fetchInfisical(cfg, f)
    expect(out).toEqual({ DATABASE_URL: 'postgres://x', DEEPGRAM_API_KEY: 'own' })
    expect(calls[0]?.url).toBe('https://vault.example.com/api/v1/auth/universal-auth/login')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      clientId: 'id-1',
      clientSecret: 'shh',
    })
    const u = new URL(calls[1]?.url ?? '')
    expect(u.searchParams.get('projectId')).toBe('proj')
    expect(u.searchParams.get('environment')).toBe('prod')
    expect(u.searchParams.get('secretPath')).toBe('gp')
  })

  it('says why it failed', async () => {
    await expect(fetchInfisical(cfg, fakeInfisical({}, { badLogin: true }).f)).rejects.toThrow(
      'Infisical 401: Invalid credentials',
    )
    await expect(fetchInfisical(cfg, fakeInfisical({}, { down: true }).f)).rejects.toThrow(
      "Can't reach https://vault.example.com",
    )
  })
})

describe('applySecrets', () => {
  it('only sets the expected secrets and GP_ settings', () => {
    const env: NodeJS.ProcessEnv = {}
    const set = applySecrets(
      {
        CLAUDE_CODE_OAUTH_TOKEN: 't',
        GP_VOICE_ID: 'v',
        PATH: '/evil',
        NODE_OPTIONS: '--x',
        EMPTY: '',
      },
      env,
    )
    expect(set.sort()).toEqual(['CLAUDE_CODE_OAUTH_TOKEN', 'GP_VOICE_ID'])
    expect(env.PATH).toBeUndefined()
  })
})

describe('scrubSecrets', () => {
  it('removes every credential name and nothing else', () => {
    const env: NodeJS.ProcessEnv = { DEEPGRAM_API_KEY: 'k', ANTHROPIC_API_KEY: 'a', GP_MODEL: 'x' }
    expect(scrubSecrets(env).sort()).toEqual(['ANTHROPIC_API_KEY', 'DEEPGRAM_API_KEY'])
    expect(env).toEqual({ GP_MODEL: 'x' })
  })
})

describe('SecretStore', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'gp-secrets-'))

  it('is unconfigured until saved, and never writes plain text', async () => {
    const d = dir()
    const { f } = fakeInfisical({ CLAUDE_CODE_OAUTH_TOKEN: 'token-123' })
    const env: NodeJS.ProcessEnv = {}
    const s = new SecretStore(d, crypto, f, env)
    expect((await s.refresh()).configured).toBe(false)
    s.saveConfig(cfg)
    for (const file of readdirSync(d))
      expect(readFileSync(join(d, file), 'utf8')).not.toContain('shh')
    expect(s.publicConfig()).toEqual({
      siteUrl: 'https://vault.example.com',
      clientId: 'id-1',
      projectId: 'proj',
      environment: 'prod',
      secretPath: '/gp',
      hasSecret: true,
    })
  })

  /** What the shell and ~/Documents/GP/.env could have put in the environment. */
  const strayEnv = (): NodeJS.ProcessEnv => ({
    DATABASE_URL: 'postgres://from-dotenv',
    CLAUDE_CODE_OAUTH_TOKEN: 'from-shell',
    ELEVENLABS_API_KEY: 'from-dotenv',
    DEEPGRAM_API_KEY: 'from-dotenv',
    ANTHROPIC_API_KEY: 'from-shell',
    GP_MIC: 'Some mic',
    PATH: '/usr/bin',
  })
  const SECRETS = [
    'DATABASE_URL',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ELEVENLABS_API_KEY',
    'DEEPGRAM_API_KEY',
    'ANTHROPIC_API_KEY',
  ]
  const allMissing = {
    DATABASE_URL: false,
    CLAUDE_CODE_OAUTH_TOKEN: false,
    ELEVENLABS_API_KEY: false,
    DEEPGRAM_API_KEY: false,
  }

  it('throws away keys from the shell or .env the moment it is built, keeping only their names', () => {
    const env = strayEnv()
    const s = new SecretStore(dir(), crypto, fakeInfisical({}).f, env)
    for (const k of SECRETS) expect(env[k]).toBeUndefined()
    expect(env.GP_MIC).toBe('Some mic')
    expect(env.PATH).toBe('/usr/bin')
    expect([...s.ignored].sort()).toEqual([...SECRETS].sort())
    expect(s.status().found).toEqual(allMissing)
    expect(JSON.stringify(s.status())).not.toContain('from-')
  })

  it('reports every secret missing when the Infisical environment is empty, whatever the Mac holds', async () => {
    const env = strayEnv()
    const s = new SecretStore(dir(), crypto, fakeInfisical({}, { noImports: true }).f, env)
    s.saveConfig(cfg)
    // A key that turns up in the environment later (some other code, a test override) counts
    // for nothing either: only a fetch from Infisical makes a secret found.
    env.DEEPGRAM_API_KEY = 'sneaked-in'
    const st = await s.refresh()
    expect(st.source).toBe('infisical')
    expect(st.error).toBeNull()
    expect(st.found).toEqual(allMissing)
    for (const k of SECRETS) expect(env[k]).toBeUndefined()
  })

  it('finds exactly what Infisical returned, and applies it', async () => {
    const env = strayEnv()
    const s = new SecretStore(
      dir(),
      crypto,
      fakeInfisical({ CLAUDE_CODE_OAUTH_TOKEN: 'token-123' }, { noImports: true }).f,
      env,
    )
    s.saveConfig(cfg)
    const st = await s.refresh()
    expect(st.found).toEqual({ ...allMissing, CLAUDE_CODE_OAUTH_TOKEN: true })
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('token-123')
    expect(env.DEEPGRAM_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })

  it('has no secrets when Infisical is down: nothing cached, nothing left in the environment', async () => {
    const d = dir()
    const env: NodeJS.ProcessEnv = {}
    const up = new SecretStore(
      d,
      crypto,
      fakeInfisical({ CLAUDE_CODE_OAUTH_TOKEN: 'token-123' }).f,
      env,
    )
    up.saveConfig(cfg)
    const ok = await up.refresh()
    expect(ok.source).toBe('infisical')
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('token-123')
    // Only the connection is on disk, and no file holds a fetched value.
    expect(readdirSync(d)).toEqual(['infisical.enc'])
    for (const file of readdirSync(d)) {
      const raw = readFileSync(join(d, file))
      expect(raw.toString('utf8')).not.toContain('token-123')
      expect(crypto.decrypt(raw)).not.toContain('token-123')
    }

    // The same running app loses Infisical: the secrets it had are dropped.
    const down = new SecretStore(d, crypto, fakeInfisical({}, { down: true }).f, env)
    const st = await down.refresh()
    expect(st.source).toBe('none')
    expect(st.error).toContain("Can't reach")
    expect(st.fetchedAt).toBeNull()
    expect(st.found).toEqual(allMissing)
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(env.DEEPGRAM_API_KEY).toBeUndefined()
  })

  it('drops a secret that was removed from Infisical on the next fetch', async () => {
    const env: NodeJS.ProcessEnv = {}
    const d = dir()
    const a = new SecretStore(
      d,
      crypto,
      fakeInfisical({ ELEVENLABS_API_KEY: 'el' }, { noImports: true }).f,
      env,
    )
    a.saveConfig(cfg)
    expect((await a.refresh()).found.ELEVENLABS_API_KEY).toBe(true)
    const b = new SecretStore(d, crypto, fakeInfisical({}, { noImports: true }).f, env)
    expect((await b.refresh()).found.ELEVENLABS_API_KEY).toBe(false)
    expect(env.ELEVENLABS_API_KEY).toBeUndefined()
  })

  it('deletes the secrets cache an earlier version left on disk', () => {
    const d = dir()
    const old = join(d, 'secrets-cache.enc')
    writeFileSync(old, crypto.encrypt(JSON.stringify({ values: { DEEPGRAM_API_KEY: 'old' } })))
    const env: NodeJS.ProcessEnv = {}
    const s = new SecretStore(d, crypto, fakeInfisical({}).f, env)
    expect(existsSync(old)).toBe(false)
    expect(s.status().found).toEqual(allMissing)
    expect(env.DEEPGRAM_API_KEY).toBeUndefined()
  })

  it('forgets the secrets in use when the connection is cleared', async () => {
    const env: NodeJS.ProcessEnv = {}
    const s = new SecretStore(dir(), crypto, fakeInfisical({ DATABASE_URL: 'postgres://x' }).f, env)
    s.saveConfig(cfg)
    await s.refresh()
    expect(env.DATABASE_URL).toBe('postgres://x')
    s.clear()
    expect(env.DATABASE_URL).toBeUndefined()
    expect(env.DEEPGRAM_API_KEY).toBeUndefined()
    expect(s.status().found).toEqual(allMissing)
  })

  it('keeps the saved client secret when the pane sends an empty one, and tests without saving', async () => {
    const d = dir()
    const { f, calls } = fakeInfisical({ DATABASE_URL: 'postgres://x' })
    const s = new SecretStore(d, crypto, f, {})
    s.saveConfig(cfg)
    s.saveConfig({ ...cfg, clientSecret: '', environment: 'dev' })
    expect(s.publicConfig()?.environment).toBe('dev')
    const t = await s.test({ ...cfg, clientSecret: '' })
    expect(t).toEqual({
      found: {
        DATABASE_URL: true,
        CLAUDE_CODE_OAUTH_TOKEN: false,
        ELEVENLABS_API_KEY: false,
        DEEPGRAM_API_KEY: true,
      },
      count: 2,
    })
    expect(JSON.parse(String(calls[0]?.init?.body)).clientSecret).toBe('shh')
    expect(() => s.saveConfig({ ...cfg, clientId: ' ', clientSecret: '' })).toThrow(
      'Missing clientId',
    )
    s.clear()
    expect(s.status().configured).toBe(false)
  })
})
