import type { InfisicalInput, SecretsStatusInfo } from '../ipc.ts'
import { esc, when } from './dom.ts'
import { gp } from './store.ts'

const CLOUD = 'https://app.infisical.com'
const ENVS = ['prod', 'dev', 'staging']

/** The four secrets GP expects in Infisical, and what each is for. */
export const SECRETS: [name: string, use: string][] = [
  ['DATABASE_URL', 'Postgres, all your history'],
  ['CLAUDE_CODE_OAUTH_TOKEN', 'Claude: the engineer, on your Max plan'],
  ['ELEVENLABS_API_KEY', "GP's voice"],
  ['DEEPGRAM_API_KEY', 'Hearing you on push-to-talk'],
]

/** Dot and words for the connection, as the Settings panel header shows it. */
export function connectionLine(s: SecretsStatusInfo | null): { dot: string; text: string } {
  if (!s || !s.configured) return { dot: 'gp-dot', text: 'Not configured' }
  const at = s.fetchedAt ? ` · last fetched ${when(s.fetchedAt)}` : ''
  if (s.source === 'infisical') return { dot: 'gp-dot gp-dot--good', text: `Connected${at}` }
  if (s.source === 'cache') return { dot: 'gp-dot gp-dot--warn', text: `Using cached secrets${at}` }
  return { dot: 'gp-dot gp-dot--bad', text: `Error · ${s.error ?? 'could not fetch secrets'}` }
}

export function secretRows(found: Record<string, boolean> | null): string {
  return SECRETS.map(([k, use], i) => {
    const ok = found ? !!found[k] : false
    const known = !!found
    return `<div class="secret" style="--i: ${i}"><span class="gp-dot ${ok ? 'gp-dot--good' : known ? 'gp-dot--bad' : ''}"></span><code>${k}</code><span class="faint">${esc(use)}</span><span class="spacer"></span>${ok ? '<span class="gp-chip">Found</span>' : known ? '<span class="gp-chip gp-chip--warn">Missing</span>' : '<span class="gp-chip gp-chip--quiet">Not checked</span>'}</div>`
  }).join('')
}

export interface InfisicalForm {
  el: HTMLElement
  value(): InfisicalInput
  /** Tests the values in the form without saving them. */
  test(): Promise<boolean>
  /** Saves and fetches; resolves with the new status, or an error message. */
  save(): Promise<SecretsStatusInfo | string>
}

/**
 * The connection fields: hosting, site URL, machine identity, project, environment, path.
 * `saved` fills them; the client secret is never shown, only whether one is stored.
 */
export function infisicalForm(
  saved: SecretsStatusInfo | null,
  opts: { hints?: 'setup' | 'settings' } = {},
): InfisicalForm {
  const c = saved?.config
  const self = !!c && c.siteUrl.replace(/\/+$/, '') !== CLOUD
  const env = c?.environment ?? 'prod'
  const envs = ENVS.includes(env) ? ENVS : [...ENVS, env]
  const el = document.createElement('div')
  el.innerHTML = `<div class="fields">
<div class="gp-field wide"><span class="gp-field-label">Hosting</span>
<div class="gp-seg" role="group" aria-label="Hosting"><button type="button" data-host="cloud" aria-pressed="${!self}">Infisical Cloud</button><button type="button" data-host="self" aria-pressed="${self}">Self-hosted</button></div></div>
<label class="gp-field wide"><span class="gp-field-label">Site URL</span><input class="gp-input" name="siteUrl" value="${esc(c?.siteUrl ?? CLOUD)}" spellcheck="false" autocomplete="off" ${self ? '' : 'readonly'}></label>
<label class="gp-field"><span class="gp-field-label">Client ID</span><input class="gp-input" name="clientId" value="${esc(c?.clientId ?? '')}" spellcheck="false" autocomplete="off" placeholder="Machine identity client ID">${opts.hints === 'settings' ? '<span class="gp-field-hint">Machine identity, Universal Auth</span>' : ''}</label>
<label class="gp-field"><span class="gp-field-label">Client secret</span><input class="gp-input" name="clientSecret" type="password" autocomplete="off" placeholder="${c?.hasSecret ? 'Saved · leave empty to keep it' : 'Paste the client secret'}"><span class="gp-field-hint">${c?.hasSecret ? 'Never shown. Leave empty to keep the saved one.' : 'Stored in the macOS Keychain, never shown again'}</span></label>
<label class="gp-field"><span class="gp-field-label">Project ID</span><input class="gp-input" name="projectId" value="${esc(c?.projectId ?? '')}" spellcheck="false" autocomplete="off"></label>
<label class="gp-field"><span class="gp-field-label">Environment</span><select class="gp-input" name="environment" style="width: 100%">${envs.map((e) => `<option value="${esc(e)}" ${e === env ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select></label>
<label class="gp-field wide"><span class="gp-field-label">Secret path</span><input class="gp-input" name="secretPath" value="${esc(c?.secretPath ?? '/gp')}" spellcheck="false" autocomplete="off"><span class="gp-field-hint">The folder that holds the four GP secrets</span></label>
</div>
<div class="card-foot" style="margin-top: 16px"><span class="testline" data-line></span><span class="spacer"></span><span data-actions></span></div>`
  const input = (n: string) => el.querySelector<HTMLInputElement>(`[name="${n}"]`)!
  let lastSelfUrl = self ? c!.siteUrl : ''
  for (const b of el.querySelectorAll<HTMLButtonElement>('[data-host]'))
    b.addEventListener('click', () => {
      const isSelf = b.dataset.host === 'self'
      for (const o of el.querySelectorAll('[data-host]'))
        o.setAttribute('aria-pressed', String(o === b))
      const url = input('siteUrl')
      if (!isSelf && url.value !== CLOUD) lastSelfUrl = url.value
      url.readOnly = !isSelf
      url.value = isSelf ? lastSelfUrl || '' : CLOUD
      if (isSelf) {
        url.placeholder = 'https://infisical.example.com'
        url.focus()
      }
    })
  const line = el.querySelector<HTMLElement>('[data-line]')!
  const say = (html: string) => {
    line.innerHTML = html
    // Re-run the fade so each result reads as new.
    line.style.animation = 'none'
    void line.offsetWidth
    line.style.animation = ''
  }
  const value = (): InfisicalInput => ({
    siteUrl: input('siteUrl').value.trim(),
    clientId: input('clientId').value.trim(),
    clientSecret: input('clientSecret').value.trim() || undefined,
    projectId: input('projectId').value.trim(),
    environment: el.querySelector<HTMLSelectElement>('[name="environment"]')!.value,
    secretPath: input('secretPath').value.trim() || '/',
  })
  const missing = () => {
    const v = value()
    const need = [
      !v.siteUrl && 'site URL',
      !v.clientId && 'client ID',
      !v.clientSecret && !c?.hasSecret && 'client secret',
      !v.projectId && 'project ID',
    ].filter(Boolean)
    return need.length ? `Add the ${need.join(', ')}.` : ''
  }
  return {
    el,
    value,
    async test() {
      const m = missing()
      if (m) {
        say(`<span class="gp-dot gp-dot--warn"></span>${esc(m)}`)
        return false
      }
      say('<span class="gp-spinner"></span><span class="muted">Testing…</span>')
      const r = await gp()
        .testSecrets(value())
        .catch((e: unknown) => ({ error: String(e) }))
      if ('error' in r) {
        say(`<span class="gp-dot gp-dot--bad"></span>${esc(r.error)}`)
        return false
      }
      const n = SECRETS.filter(([k]) => r.found[k]).length
      say(
        `<span class="gp-dot ${n === SECRETS.length ? 'gp-dot--good' : 'gp-dot--warn'}"></span>Connected. ${n} of ${SECRETS.length} secrets found.`,
      )
      return true
    },
    async save() {
      const m = missing()
      if (m) {
        say(`<span class="gp-dot gp-dot--warn"></span>${esc(m)}`)
        return m
      }
      say('<span class="gp-spinner"></span><span class="muted">Saving and fetching…</span>')
      const r = await gp()
        .saveSecrets(value())
        .catch((e: unknown) => ({ error: String(e) }))
      if ('error' in r && !('configured' in r)) {
        say(`<span class="gp-dot gp-dot--bad"></span>${esc(r.error)}`)
        return r.error ?? 'Could not save'
      }
      const st = r as SecretsStatusInfo
      input('clientSecret').value = ''
      const l = connectionLine(st)
      say(
        `<span class="${l.dot}"></span>${esc(st.error && st.source !== 'infisical' ? st.error : `Saved. ${l.text}`)}`,
      )
      return st
    },
  }
}
