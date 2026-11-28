import { teamColorByName } from '@gp/ui'
import type { AppSettings, CareersInfo, SettingsPatch, UpdateState } from '../../ipc.ts'
import { fromPreflight, kbd, levelMeter, patchChecks, setLevel } from '../checks.ts'
import { $, esc, setHtml, when } from '../dom.ts'
import { connectionLine, infisicalForm, secretRows } from '../infisical.ts'
import { install } from '../shell.ts'
import { get, gp, refreshStatus, runPreflight, set, watch } from '../store.ts'

const TABS = [
  ['connections', 'Connections'],
  ['voice', 'Voice'],
  ['radio', 'Radio'],
  ['data', 'Data'],
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
    cleanup = { connections, voice, radio, data, checks, updates }[t](body)
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

// ------------------------------------------------------------------ voice

function voice(body: HTMLElement): () => void {
  body.innerHTML = `<section class="gp-panel gp-page">
<div class="gp-setting"><div class="gp-setting-text">Output<span>Where GP's voice plays. Change it in macOS Sound settings.</span></div><span class="muted" data-out></span></div>
<div class="gp-setting"><div class="gp-setting-text">Microphone<span>DualSense when plugged in with USB, else the Mac</span></div><span class="muted" data-mic></span>${levelMeter()}</div>
<div class="gp-setting"><div class="gp-setting-text">Push-to-talk<span>Hold to talk, press again to cut GP off</span></div><span data-ptt></span></div>
<div class="gp-setting"><div class="gp-setting-text">Voice<span data-voicesub></span></div><span class="faint" data-credits></span><button class="gp-button gp-button--sm" data-test>Test voice</button></div>
<p class="gp-field-error hidden" data-err style="margin-top: 8px"></p>
</section>`
  const test = $<HTMLButtonElement>('[data-test]', body)
  test.addEventListener('click', async () => {
    test.disabled = true
    test.innerHTML =
      '<span class="gp-typing" style="height: 12px; padding: 0"><i></i><i></i><i></i></span>Playing'
    const r = await gp()
      .testVoice()
      .catch((e: unknown) => ({ error: String(e) }))
    const err = $('[data-err]', body)
    err.classList.toggle('hidden', !('error' in r))
    if ('error' in r) err.textContent = r.error
    // The line is handed to the player now; give it a moment to be heard.
    setTimeout(
      () => {
        test.disabled = false
        test.textContent = 'Test voice'
      },
      'error' in r ? 0 : 2500,
    )
  })
  const fast = setInterval(() => void refreshStatus(), 120)
  const unwatch = watch(['status'], ({ status: s }) => {
    if (!s) return
    setHtml($('[data-out]', body), esc(s.outputDevice ?? 'System default'))
    setHtml(
      $('[data-mic]', body),
      esc(
        s.mic.permission !== 'granted'
          ? 'Not allowed yet'
          : s.controller.connected && s.controller.transport === 'usb'
            ? 'DualSense microphone'
            : 'Mac microphone',
      ),
    )
    setHtml(
      $('[data-ptt]', body),
      s.controller.connected
        ? kbd(s.controller.pushToTalk || 'L3')
        : '<span class="faint">No controller</span>',
    )
    const eleven = s.voice.tts === 'elevenlabs'
    setHtml(
      $('[data-voicesub]', body),
      esc(
        eleven
          ? 'ElevenLabs voice, short lines are cached to save credits'
          : "Mac voice. Add ELEVENLABS_API_KEY to Infisical for GP's own voice.",
      ),
    )
    const left = s.elevenLabs.charactersLeft
    setHtml(
      $('[data-credits]', body),
      eleven && left != null ? `${esc(left.toLocaleString('en-GB'))} credits left` : '',
    )
    setLevel(body, s.micLevel)
  })
  return () => {
    clearInterval(fast)
    unwatch()
  }
}

// ------------------------------------------------------------------ radio

const switchEl = (key: string, on: boolean, label: string) =>
  `<button class="gp-switch" role="switch" aria-checked="${on}" data-switch="${key}" aria-label="${esc(label)}"></button>`

function radio(body: HTMLElement): () => void {
  let cur: AppSettings | null = null
  const paint = (st: AppSettings) => {
    cur = st
    const r = st.radio
    body.innerHTML = `<section class="gp-panel gp-page">
<div class="gp-setting"><div class="gp-setting-text">How much GP talks<span>Quiet is the essentials only. Chatty adds gaps and season context.</span></div><div class="gp-seg">${(
      [
        ['quiet', 'Quiet'],
        ['normal', 'Normal'],
        ['chatty', 'Chatty'],
      ] as const
    )
      .map(
        ([k, l]) => `<button data-chat="${k}" aria-pressed="${r.chattiness === k}">${l}</button>`,
      )
      .join('')}</div></div>
<div class="gp-setting"><div class="gp-setting-text">Calls in corners<span>Off: only urgent calls while you're turning</span></div>${switchEl('callsInCorners', r.callsInCorners, 'Calls in corners')}</div>
<div class="gp-setting"><div class="gp-setting-text">Encouragement<span>Specific and earned. Never generic.</span></div>${switchEl('encouragement', r.encouragement, 'Encouragement')}</div>
<div class="gp-setting"><div class="gp-setting-text">Call lost places<span>When you drop two or more</span></div>${switchEl('callLostPlaces', r.callLostPlaces, 'Call lost places')}</div>
<div class="gp-setting"><div class="gp-setting-text">Where you're losing time<span>One corner and the fix, only on a straight. Races and practice.</span></div>${switchEl('timeLossCalls', r.timeLossCalls, 'Where you are losing time')}</div>
<div class="row" style="margin-top: 8px"><span class="faint" style="font-size: 12px" data-saved>Changes reach GP straight away, even mid-session.</span></div>
</section>`
  }
  const save = async (patch: SettingsPatch) => {
    const r = await gp().saveSettings(patch)
    const note = body.querySelector('[data-saved]')
    if ('error' in r) {
      if (note) note.textContent = r.error
      if (cur) paint(cur)
      return
    }
    paint(r)
    const n = body.querySelector('[data-saved]')
    if (n) n.textContent = 'Saved. GP uses it from his next call.'
  }
  body.addEventListener('click', onClick)
  function onClick(e: Event) {
    const t = e.target as HTMLElement
    const chat = t.closest<HTMLElement>('[data-chat]')
    if (chat) {
      for (const b of body.querySelectorAll('[data-chat]'))
        b.setAttribute('aria-pressed', String(b === chat))
      return void save({
        radio: { chattiness: chat.dataset.chat as AppSettings['radio']['chattiness'] },
      })
    }
    const sw = t.closest<HTMLElement>('[data-switch]')
    if (sw) {
      const on = sw.getAttribute('aria-checked') !== 'true'
      sw.setAttribute('aria-checked', String(on))
      return void save({ radio: { [sw.dataset.switch!]: on } })
    }
  }
  body.innerHTML =
    '<section class="gp-panel gp-page"><span class="gp-skel" style="height: 160px; display: block"></span></section>'
  void gp().settings().then(paint)
  return () => body.removeEventListener('click', onClick)
}

// ------------------------------------------------------------------ data

function data(body: HTMLElement): () => void {
  body.innerHTML = `<div class="gp-page">
<section class="gp-panel"><div class="panel-head"><h2 class="h">Sync</h2><span class="spacer"></span><span class="gp-statusline" data-sync></span></div><div class="gp-stats" data-stats></div></section>
<section class="gp-panel"><div class="panel-head"><h2 class="h">Careers</h2></div><div data-careers><span class="gp-skel" style="height: 44px; display: block"></span></div></section>
<section class="gp-panel"><div class="gp-setting"><div class="gp-setting-text">Raw recordings to keep<span data-keepsub>Deleted once a session is read into the history. Keep a few for bug reports.</span></div><div class="gp-seg" data-keep>${(
    [
      [0, 'None'],
      [2, 'Last 2'],
      [5, 'Last 5'],
    ] as const
  )
    .map(([k, l]) => `<button data-keepv="${k}" aria-pressed="false">${l}</button>`)
    .join('')}</div></div></section>
</div>`
  let alive = true
  let careers: CareersInfo | null = null
  let editing: string | null = null
  let merging: string | null = null

  const paintCareers = () => {
    const el = $('[data-careers]', body)
    const cs = careers?.careers ?? []
    if (!cs.length) {
      el.innerHTML =
        '<p class="muted">No careers yet. GP files your first career season after its first session, or asks you where it goes.</p>'
      return
    }
    el.innerHTML = cs
      .map((c) => {
        const team = c.seasons.find((x) => x.team)?.team ?? null
        const sub = [team, `${c.seasons.length} ${c.seasons.length === 1 ? 'season' : 'seasons'}`]
          .filter(Boolean)
          .join(' · ')
        if (editing === c.id)
          return `<form class="gp-setting" data-rename="${esc(c.id)}"><span class="gp-team-tick" style="--gp-team: ${teamColorByName(team)}"></span><input class="gp-input" style="flex: 1" value="${esc(c.name)}" aria-label="Career name" data-name><button class="gp-button gp-button--sm gp-button--ghost" type="button" data-cancel>Cancel</button><button class="gp-button gp-button--sm gp-button--primary" type="submit">Save</button></form>`
        if (merging === c.id)
          return `<div class="gp-setting"><span class="gp-team-tick" style="--gp-team: ${teamColorByName(team)}"></span><div class="gp-setting-text">Merge ${esc(c.name)} into<span>Its seasons and sessions move; ${esc(c.name)} goes away.</span></div><select class="gp-input" data-into>${cs
            .filter((o) => o.id !== c.id)
            .map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`)
            .join(
              '',
            )}</select><button class="gp-button gp-button--sm gp-button--ghost" data-cancel>Cancel</button><button class="gp-button gp-button--sm gp-button--primary" data-domerge="${esc(c.id)}">Merge</button></div>`
        return `<div class="gp-setting"><span class="gp-team-tick" style="--gp-team: ${teamColorByName(team)}"></span><div class="gp-setting-text">${esc(c.name)}<span>${esc(sub)}</span></div><button class="gp-button gp-button--sm" data-edit="${esc(c.id)}">Rename</button>${cs.length > 1 ? `<button class="gp-button gp-button--sm" data-merge="${esc(c.id)}">Merge…</button>` : ''}</div>`
      })
      .join('')
    if (careers?.unassigned.length)
      el.insertAdjacentHTML(
        'beforeend',
        `<p class="faint" style="font-size: 12px; margin-top: 8px">${careers.unassigned.length} career ${careers.unassigned.length === 1 ? 'season is' : 'seasons are'} not filed yet. File them from a session's Change filing menu in Debrief.</p>`,
      )
    el.querySelector<HTMLInputElement>('[data-name]')?.focus()
  }
  const err = (msg: string) => {
    $('[data-careers]', body).insertAdjacentHTML(
      'beforeend',
      `<p class="gp-field-error">${esc(msg)}</p>`,
    )
  }

  body.addEventListener('click', onClick)
  body.addEventListener('submit', onSubmit)
  async function onClick(e: Event) {
    const t = e.target as HTMLElement
    const edit = t.closest<HTMLElement>('[data-edit]')
    if (edit) {
      editing = edit.dataset.edit!
      merging = null
      return paintCareers()
    }
    const m = t.closest<HTMLElement>('[data-merge]')
    if (m) {
      merging = m.dataset.merge!
      editing = null
      return paintCareers()
    }
    if (t.closest('[data-cancel]')) {
      editing = merging = null
      return paintCareers()
    }
    const dm = t.closest<HTMLButtonElement>('[data-domerge]')
    if (dm) {
      dm.disabled = true
      const r = await gp().mergeCareers(
        dm.dataset.domerge!,
        $<HTMLSelectElement>('[data-into]', body).value,
      )
      if ('error' in r) return err(r.error)
      careers = r
      merging = null
      return paintCareers()
    }
    const k = t.closest<HTMLButtonElement>('[data-keepv]')
    if (k && !k.disabled) {
      for (const b of body.querySelectorAll('[data-keepv]'))
        b.setAttribute('aria-pressed', String(b === k))
      await gp().saveSettings({ keepRecordings: Number(k.dataset.keepv) as 0 | 2 | 5 })
    }
  }
  async function onSubmit(e: Event) {
    const f = (e.target as HTMLElement).closest<HTMLFormElement>('[data-rename]')
    if (!f) return
    e.preventDefault()
    const name = $<HTMLInputElement>('[data-name]', f).value.trim()
    if (!name) return
    const r = await gp().renameCareer(f.dataset.rename!, name)
    if ('error' in r) return err(r.error)
    careers = r
    editing = null
    paintCareers()
  }

  void Promise.all([
    gp()
      .careers()
      .catch(() => null),
    gp()
      .dataInfo()
      .catch(() => null),
  ]).then(([c, info]) => {
    if (!alive) return
    careers = c
    paintCareers()
    if (info) {
      for (const b of body.querySelectorAll<HTMLButtonElement>('[data-keepv]')) {
        b.setAttribute('aria-pressed', String(Number(b.dataset.keepv) === info.recordingsKept))
        b.disabled = info.recordingsOverride
      }
      if (info.recordingsOverride)
        $('[data-keepsub]', body).textContent =
          'Set by GP_KEEP_RECORDINGS on this Mac, so it can only be changed there.'
    }
    paintSync(info)
  })
  let lastInfo: Awaited<ReturnType<ReturnType<typeof gp>['dataInfo']>> | null = null
  const paintSync = (info: typeof lastInfo) => {
    if (info) lastInfo = info
    const d = get().status?.database
    if (!d) return
    const line = !d.configured
      ? '<span class="gp-dot gp-dot--warn"></span>No DATABASE_URL yet. Everything stays on this Mac.'
      : d.error
        ? `<span class="gp-dot gp-dot--bad"></span>Can't reach Postgres: ${esc(d.error)}`
        : `<span class="gp-dot gp-dot--good"></span>Postgres connected${d.lastSyncAt ? ` · last sync ${esc(when(d.lastSyncAt))}` : ''}`
    setHtml($('[data-sync]', body), line)
    const stat = (l: string, v: string, small = '') =>
      `<div class="gp-stat"><span class="gp-stat-label">${esc(l)}</span><div class="gp-stat-value">${esc(v)}${small ? ` <small>${esc(small)}</small>` : ''}</div></div>`
    setHtml(
      $('[data-stats]', body),
      [
        stat('Sessions', lastInfo ? String(lastInfo.sessions) : '–'),
        stat('Waiting', d.configured ? String(d.pending) : '–'),
        stat('First synced', lastInfo?.firstSyncAt ? when(lastInfo.firstSyncAt) : 'not yet'),
      ].join(''),
    )
  }
  const unwatch = watch(['status'], () => paintSync(null))
  return () => {
    alive = false
    unwatch()
    body.removeEventListener('click', onClick)
    body.removeEventListener('submit', onSubmit)
  }
}
