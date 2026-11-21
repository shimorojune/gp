import type { UpdateState } from '../../ipc.ts'
import { fromPreflight, patchChecks } from '../checks.ts'
import { $, esc, setHtml, when } from '../dom.ts'
import { connectionLine, infisicalForm, secretRows } from '../infisical.ts'
import { install } from '../shell.ts'
import { get, gp, refreshStatus, runPreflight, set, watch } from '../store.ts'

const TABS = [
  ['connections', 'Connections'],
  ['checks', 'Checks'],
  ['updates', 'Updates'],
] as const
type Tab = (typeof TABS)[number][0]

export function settingsPage(root: HTMLElement, arg?: string): () => void {
  let tab: Tab = (TABS.find(([k]) => k === arg)?.[0] ?? 'connections') as Tab
  root.innerHTML = `<div class="page settings gp-page" style="max-width: 860px">
<div class="page-head"><div><h1 class="title">Settings</h1></div></div>
<nav class="gp-tabs" role="tablist">${TABS.map(([k, l]) => `<button class="gp-tab" role="tab" data-tab="${k}">${l}</button>`).join('')}</nav>
<div data-tab-body></div></div>`
  const body = $('[data-tab-body]', root)
  let cleanup: (() => void) | undefined
  const show = (t: Tab) => {
    cleanup?.()
    tab = t
    for (const b of root.querySelectorAll<HTMLElement>('[data-tab]'))
      b.setAttribute('aria-selected', String(b.dataset.tab === t))
    body.innerHTML = ''
    cleanup =
      t === 'connections' ? connections(body) : t === 'checks' ? checks(body) : updates(body)
  }
  for (const b of root.querySelectorAll<HTMLElement>('[data-tab]'))
    b.addEventListener('click', () => show(b.dataset.tab as Tab))
  show(tab)
  return () => cleanup?.()
}

function connections(body: HTMLElement): () => void {
  const wrap = document.createElement('div')
  wrap.className = 'gp-page'
  body.append(wrap)
  let alive = true
  void gp()
    .secretsStatus()
    .catch(() => get().status?.secrets ?? null)
    .then((sec) => {
      if (!alive) return
      const form = infisicalForm(sec, { hints: 'settings' })
      wrap.innerHTML = `<section class="gp-panel">
<div class="panel-head"><h2 class="h">Infisical</h2><span class="spacer"></span><span class="gp-statusline" data-conn></span></div>
<p class="muted" style="margin-bottom: 16px">Every key GP uses lives here. This Mac keeps only how to reach Infisical, in the Keychain, plus an encrypted copy of the last secrets so the radio works offline.</p>
<div data-form></div></section>
<section class="gp-panel"><div class="panel-head"><h2 class="h">Secrets GP expects</h2><span class="spacer"></span><span class="faint" style="font-size: 12px">Values are never shown</span></div><div data-secrets></div></section>`
      $('[data-form]', wrap).append(form.el)
      const actions = $('[data-actions]', form.el)
      actions.className = 'row'
      actions.innerHTML = `${sec?.configured ? '<button class="gp-button gp-button--ghost" data-clear>Disconnect</button>' : ''}<button class="gp-button" data-test>Test connection</button><button class="gp-button gp-button--primary" data-save>Save</button>`
      $('[data-test]', actions).addEventListener('click', () => void form.test())
      $('[data-save]', actions).addEventListener('click', async () => {
        const r = await form.save()
        if (typeof r !== 'string') {
          void refreshStatus()
          paint(r)
        }
      })
      actions.querySelector('[data-clear]')?.addEventListener('click', async (e) => {
        const b = e.currentTarget as HTMLButtonElement
        if (b.dataset.sure !== '1') {
          // Two presses: the first says what happens.
          b.dataset.sure = '1'
          b.textContent = 'Press again to disconnect'
          setTimeout(() => {
            b.dataset.sure = ''
            b.textContent = 'Disconnect'
          }, 4000)
          return
        }
        paint(await gp().clearSecrets())
        void refreshStatus()
      })
      const paint = (s: typeof sec) => {
        const l = connectionLine(s)
        setHtml($('[data-conn]', wrap), `<span class="${l.dot}"></span>${esc(l.text)}`)
        setHtml($('[data-secrets]', wrap), secretRows(s?.configured ? s.found : null))
      }
      paint(sec)
    })
  return () => {
    alive = false
  }
}

function checks(body: HTMLElement): () => void {
  body.innerHTML = `<section class="gp-panel gp-page"><div class="panel-head"><h2 class="h">Start-up checks</h2><span class="spacer"></span><span class="faint" data-at style="font-size: 12px"></span><button class="gp-button" data-again>Check again</button></div><div class="gp-checks" data-list></div></section>`
  const again = $<HTMLButtonElement>('[data-again]', body)
  const runNow = async () => {
    again.disabled = true
    again.innerHTML = '<span class="gp-spinner"></span>Checking…'
    await runPreflight().catch(() => null)
    again.disabled = false
    again.textContent = 'Check again'
  }
  again.addEventListener('click', () => void runNow())
  if (!get().preflight) void runNow()
  return watch(['preflight'], ({ preflight }) => {
    if (!preflight) return
    patchChecks($('[data-list]', body), preflight.checks.map(fromPreflight))
    $('[data-at]', body).textContent = `Ran ${when(new Date().toISOString())}`
  })
}

function updates(body: HTMLElement): () => void {
  body.innerHTML = `<section class="gp-panel gp-page"><div class="panel-head"><h2 class="h" data-ver></h2><span class="spacer"></span><span class="faint">Updates from GitHub Releases</span></div><div data-state></div></section>`
  let refused = ''
  const onRefused = (e: Event) => {
    refused = String((e as CustomEvent).detail ?? '')
    paint(get().update)
  }
  window.addEventListener('gp:update-refused', onRefused)
  const paint = (u: UpdateState | null) => {
    const app = get().app
    $('[data-ver]', body).textContent = `GP ${app?.version ?? ''}`
    const el = $('[data-state]', body)
    const p = u?.phase ?? 'idle'
    const checkBtn = '<button class="gp-button" data-check>Check for updates</button>'
    const notes = u?.notes
      ? `<ul class="setup-list">${u.notes
          .split('\n')
          .map((l) => l.replace(/^[\s*-]+/, '').trim())
          .filter((l) => l && !l.startsWith('#'))
          .slice(0, 8)
          .map((l) => `<li>${esc(l.replace(/\*\*|`/g, ''))}</li>`)
          .join('')}</ul>`
      : ''
    let html: string
    if (p === 'disabled')
      html = `<div class="row testline"><span class="gp-dot"></span><span class="muted">${esc(u?.message ?? 'Updates are off in a copy run from the repo.')}</span></div>`
    else if (p === 'checking')
      html =
        '<div class="row testline"><span class="gp-spinner"></span><span class="muted">Checking…</span></div>'
    else if (p === 'downloading' || p === 'verifying')
      html = `<div class="stack testline"><div class="row"><span class="muted">${p === 'verifying' ? `Checking ${esc(u?.version ?? '')}` : `Downloading ${esc(u?.version ?? '')}`}</span><span class="spacer"></span><span class="num faint">${u?.progress ?? 0}%</span></div><div class="progress" style="--v: ${(u?.progress ?? 0) / 100}"><i></i></div>${notes}</div>`
    else if (p === 'ready')
      html = `<div class="stack testline"><div class="row"><span class="gp-dot gp-dot--good"></span><span><b>GP ${esc(u?.version ?? '')} is ready to install.</b> Restart when you're not driving.</span><span class="spacer"></span><button class="gp-button gp-button--primary" data-install>Restart to update</button></div>${refused ? `<p class="muted">${esc(refused)}</p>` : ''}${notes}</div>`
    else if (p === 'installing')
      html = `<div class="row testline"><span class="gp-spinner"></span><span class="muted">Installing ${esc(u?.version ?? '')}…</span></div>`
    else if (p === 'error')
      html = `<div class="row testline"><span class="gp-dot gp-dot--bad"></span><span>${esc(u?.message ?? 'Update failed')}</span><span class="spacer"></span>${checkBtn}</div>`
    else
      html = `<div class="row testline"><span class="gp-dot gp-dot--good"></span><span>${p === 'up-to-date' ? `Up to date${u?.checkedAt ? ` as of ${esc(when(u.checkedAt))}` : ''}.` : esc(u?.message ?? 'Checks every few hours.')}</span><span class="spacer"></span>${checkBtn}</div>`
    if (setHtml(el, html)) {
      el.querySelector('[data-check]')?.addEventListener('click', async () => {
        set({ update: await gp().checkUpdate() })
      })
      el.querySelector('[data-install]')?.addEventListener('click', () => void install())
    }
  }
  const unwatch = watch(['update', 'app'], ({ update }) => paint(update))
  return () => {
    unwatch()
    window.removeEventListener('gp:update-refused', onRefused)
  }
}
