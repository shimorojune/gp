import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type SecretCrypto, SecretStore, applySecrets, fetchInfisical } from './secrets.ts'

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
  opts: { down?: boolean; badLogin?: boolean } = {},
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
        imports: [{ secrets: [{ secretKey: 'DEEPGRAM_API_KEY', secretValue: 'from-import' }] }],
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

  it('applies fetched secrets, then falls back to the encrypted cache when Infisical is down', async () => {
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
    expect(ok.found.CLAUDE_CODE_OAUTH_TOKEN).toBe(true)
    expect(ok.found.DATABASE_URL).toBe(false)
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('token-123')
    for (const file of readdirSync(d))
      expect(readFileSync(join(d, file), 'utf8')).not.toContain('token-123')

    const env2: NodeJS.ProcessEnv = {}
    const down = new SecretStore(d, crypto, fakeInfisical({}, { down: true }).f, env2)
    const st = await down.refresh()
    expect(st.source).toBe('cache')
    expect(st.error).toContain("Can't reach")
    expect(st.fetchedAt).toBe(ok.fetchedAt)
    expect(env2.CLAUDE_CODE_OAUTH_TOKEN).toBe('token-123')
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
