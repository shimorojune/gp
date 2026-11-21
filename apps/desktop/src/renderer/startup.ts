import type { PreflightResult } from '../ipc.ts'
import {
  type CheckRow,
  NAMES,
  ORDER,
  fromPreflight,
  kbd,
  levelMeter,
  patchChecks,
  setLevel,
} from './checks.ts'
import { $, esc, mark, sleep } from './dom.ts'
import { SECRETS, infisicalForm, secretRows } from './infisical.ts'
import { get, gp, refreshStatus, runPreflight, set, watch } from './store.ts'

/** Where start-up hands over. */
export type Exit = { to: 'app' } | { to: 'settings' }

const SKIP_SETUP = 'gp.setupSkipped'

function layer(root: HTMLElement, cls: string, html: string): HTMLElement {
  const l = document.createElement('div')
  l.className = `layer ${cls}`
  l.innerHTML = html
  root.append(l)
  return l
}

/** Fades a layer out, then removes it. */
async function leave(l: HTMLElement): Promise<void> {
  l.classList.add('is-leaving')
  await sleep(220)
  l.remove()
}

/**
 * Splash (the mark builds bar by bar) while the checks start in the background, then the
 * start-up checks in the same window, then first-run setup when Infisical isn't set up.
 */
export async function startup(root: HTMLElement): Promise<Exit> {
  // A check run that throws still ends the start-up: it shows as one failed row.
  const pf = runPreflight().catch(
    (e: unknown): PreflightResult => ({
      checks: [
        {
          id: 'checks',
          label: 'Start-up checks',
          status: 'fail',
          detail: `Couldn't run: ${String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': /, '')}`,
        },
      ],
      firstRun: false,
    }),
  )
  const ver = get().app?.version ?? ''
  const splash = layer(
    root,
    'gp-splash',
    `${mark(72)}<span class="gp-splash-word">GP</span><span class="gp-splash-progress"><i></i></span><span class="gp-splash-status" aria-live="polite">Starting GP ${esc(ver)}</span>`,
  )
  const status = $('.gp-splash-status', splash)
  const msg = (t: string) => {
    status.textContent = t
    status.style.animation = 'none'
    void status.offsetWidth
    status.style.animation = ''
  }
  await sleep(900)
  msg('Fetching secrets from Infisical…')
  await sleep(800)
  msg('Connecting to Postgres…')
  await sleep(900)
  const checks = await showChecks(root, pf, () => leave(splash))
  if (checks.exit) return checks.exit
  // Not set up yet: the first-run steps, unless you chose to skip them before.
  const sec = get().status?.secrets ?? (await refreshStatus())?.secrets
  if (sec && !sec.configured && localStorage.getItem(SKIP_SETUP) !== '1') {
    await firstRun(root)
  }
  return { to: 'app' }
}

/** The check list, revealed top to bottom as the results come in. */
async function showChecks(
  root: HTMLElement,
  pending: Promise<PreflightResult>,
  before: () => Promise<void>,
): Promise<{ exit: Exit | null }> {
  const l = layer(
    root,
    'center gp-page',
    `<div class="card">
<div class="card-head">${mark(20)}<div><h1 class="title">Start-up checks</h1><p class="muted">Everything a race needs, checked every time GP opens. The Status page shows the same list live.</p></div><span class="spacer"></span><span class="gp-label num" data-count></span></div>
<div class="gp-panel"><div class="gp-checks" data-list aria-live="polite"></div></div>
<div class="card-foot" data-foot><span class="gp-spinner"></span><span class="muted">Checking…</span></div>
</div>`,
  )
  void before()
  const list = $('[data-list]', l)
  const count = $('[data-count]', l)
  const foot = $('[data-foot]', l)
  let result: PreflightResult | null = null
  void pending.then((r) => {
    result = r
  })
  // Until the results arrive the list follows the usual order; then it is exactly what ran.
  const ids = (): string[] => (result ? result.checks.map((c) => c.id) : [...ORDER])
  const rows = (shown: number): CheckRow[] =>
    ids().map((id, i) => {
      const c = result?.checks.find((x) => x.id === id)
      if (i < shown && c) return fromPreflight(c)
      return {
        id,
        name: NAMES[id] ?? c?.label ?? id,
        state: i === shown ? 'running' : 'pending',
        detail: i === shown ? 'Checking…' : 'Waiting',
      }
    })
  // One row every 230 ms, never ahead of the real results.
  let shown = 0
  patchChecks(list, rows(0))
  for (;;) {
    const total = ids().length
    count.textContent = `${Math.min(shown, total)} of ${total}`
    if (result && shown >= total) break
    await sleep(230)
    if (result) shown++
    patchChecks(list, rows(shown))
  }
  const r = result as unknown as PreflightResult
  const fails = r.checks.filter((c) => c.status === 'fail').length
  const warns = r.checks.filter((c) => c.status === 'warn').length
  const summary = fails
    ? `${fails} ${fails === 1 ? 'check' : 'checks'} failed. GP can still run with what works.`
    : warns
      ? `Ready. ${warns} ${warns === 1 ? 'thing' : 'things'} to keep an eye on.`
      : 'Everything is green.'
  return new Promise((resolve) => {
    const done = async (exit: Exit | null) => {
      clearTimeout(auto)
      await leave(l)
      resolve({ exit })
    }
    let auto: ReturnType<typeof setTimeout> | undefined
    if (fails) {
      foot.innerHTML = `<span class="gp-dot gp-dot--bad gp-pop"></span><span class="gp-fade-in">${esc(summary)}</span><span class="spacer"></span><button class="gp-button" data-open>Open anyway</button><button class="gp-button gp-button--primary gp-pop" data-fix>Fix in Settings</button>`
      $('[data-fix]', foot).addEventListener('click', () => void done({ to: 'settings' }))
    } else {
      foot.innerHTML = `<span class="gp-dot gp-dot--good gp-pop"></span><span class="gp-fade-in">${esc(summary)} Opening GP…</span><span class="spacer"></span><button class="gp-button gp-button--primary gp-pop" data-open>Open GP now</button>`
      auto = setTimeout(() => void done(null), 1400)
    }
    $('[data-open]', foot).addEventListener('click', () => void done(null))
  })
}

/** First run: Welcome, Infisical, Secrets, Controller and audio, Ready. */
async function firstRun(root: HTMLElement): Promise<void> {
  const STEPS = ['Welcome', 'Infisical', 'Secrets', 'Controller', 'Ready']
  const l = layer(
    root,
    'center',
    `<div class="card" style="max-width: 640px"><ol class="gp-steps" style="margin-bottom: 32px">${STEPS.map((s) => `<li>${s}</li>`).join('')}</ol><div data-body></div></div>`,
  )
  const body = $('[data-body]', l)
  const stepEls = [...l.querySelectorAll<HTMLElement>('.gp-steps li')]
  let stop: (() => void) | null = null
  const nav = (back: boolean, next = 'Continue') =>
    `<div class="row">${back ? '<button class="gp-button gp-button--ghost" data-back>Back</button>' : ''}<span class="spacer"></span><button class="gp-button gp-button--primary" data-next>${next}</button></div>`

  return new Promise<void>((resolve) => {
    const go = async (i: number) => {
      stop?.()
      stop = null
      stepEls.forEach((s, k) => {
        s.dataset.state = k < i ? 'done' : k === i ? 'current' : 'todo'
        if (k === i) s.setAttribute('aria-current', 'step')
        else s.removeAttribute('aria-current')
      })
      body.innerHTML = ''
      const page = document.createElement('div')
      page.className = i === 0 || i === 4 ? 'hello gp-page' : 'stack gp-page'
      body.append(page)
      const wire = () => {
        page.querySelector('[data-back]')?.addEventListener('click', () => void go(i - 1))
      }
      if (i === 0) {
        page.innerHTML = `${mark(40)}<h1 class="title">GP, your race engineer</h1>
<p class="muted">I talk to you on the radio while you drive, and after every session I write the debrief and file it: careers, time trials per car, and everything else as sim runs. Ask me anything about it later.</p>
<p class="muted">First, where your keys live. I keep none of them on this Mac except how to reach Infisical, in the Keychain.</p>
<div class="row" style="margin-top: 8px"><button class="gp-button gp-button--primary" data-next>Get started</button><button class="gp-button gp-button--ghost" data-skip>Skip, use the keys on this Mac</button></div>`
        $('[data-next]', page).addEventListener('click', () => void go(1))
        $('[data-skip]', page).addEventListener('click', () => {
          localStorage.setItem(SKIP_SETUP, '1')
          void finish()
        })
      } else if (i === 1) {
        const form = infisicalForm(get().status?.secrets ?? null, { hints: 'setup' })
        page.innerHTML = `<div><h1 class="title">Connect Infisical</h1><p class="muted">Use a machine identity with Universal Auth. GP only reads secrets.</p></div><div class="gp-panel" data-form></div>${nav(true)}`
        $('[data-form]', page).append(form.el)
        const actions = $('[data-actions]', form.el)
        actions.innerHTML = '<button class="gp-button" data-test>Test connection</button>'
        $('[data-test]', actions).addEventListener('click', () => void form.test())
        $('[data-next]', page).addEventListener('click', async () => {
          const r = await form.save()
          if (typeof r === 'string') return
          set({ status: get().status ? { ...get().status!, secrets: r } : null })
          void go(2)
        })
        wire()
      } else if (i === 2) {
        const sec =
          (await gp()
            .secretsStatus()
            .catch(() => null)) ??
          get().status?.secrets ??
          null
        const n = sec ? SECRETS.filter(([k]) => sec.found[k]).length : 0
        page.innerHTML = `<div><h1 class="title">Secrets ${n === SECRETS.length ? 'found' : `found: ${n} of ${SECRETS.length}`}</h1><p class="muted">Read from Infisical. Values are never shown.${n < SECRETS.length ? ' Add the missing ones in Infisical; GP falls back to local speech and the Mac voice without the voice keys.' : ''}</p></div><div class="gp-panel">${secretRows(sec?.found ?? null)}</div>${nav(true)}`
        $('[data-next]', page).addEventListener('click', () => void go(3))
        wire()
      } else if (i === 3) {
        page.innerHTML = `<div><h1 class="title">Controller and audio</h1><p class="muted">Plug the DualSense in with USB. Its mic is how I hear you.</p></div><div class="gp-panel"><div class="gp-checks" data-list></div></div>${nav(true)}`
        const list = $('[data-list]', page)
        const poll = setInterval(() => void refreshStatus(), 250)
        const unwatch = watch(['status'], ({ status: s }) => {
          if (!s) return
          const ptt = s.controller.pushToTalk || 'L3'
          patchChecks(list, [
            {
              id: 'dualsense',
              name: 'DualSense',
              state: s.controller.connected ? 'ok' : 'warn',
              detail: s.controller.connected
                ? `Connected over ${s.controller.transport === 'bluetooth' ? 'Bluetooth (its mic needs USB)' : 'USB'}`
                : 'Not found. Plug it in with USB for push-to-talk and the mic.',
            },
            {
              id: 'mic',
              name: 'Microphone',
              state:
                s.mic.permission === 'granted'
                  ? 'ok'
                  : s.mic.permission === 'not-determined'
                    ? 'warn'
                    : 'fail',
              detail:
                s.mic.permission === 'granted'
                  ? 'Allowed'
                  : s.mic.permission === 'not-determined'
                    ? 'macOS asks the first time you press push-to-talk.'
                    : 'Denied. System Settings → Privacy & Security → Microphone → turn GP on.',
              meta: levelMeter(),
            },
            {
              id: 'output',
              name: 'Output',
              state: s.outputDevice ? 'ok' : 'warn',
              detail: s.outputDevice ?? 'Unknown. GP speaks on the Mac’s default output.',
            },
            {
              id: 'ptt',
              name: 'Push-to-talk',
              state: s.controller.connected ? 'ok' : 'pending',
              detail: s.controller.connected
                ? `Hold ${ptt} and say “radio check”. I’ll answer.`
                : 'Waiting for the controller',
              meta: kbd(ptt),
            },
          ])
          setLevel(list, s.micLevel)
        })
        stop = () => {
          clearInterval(poll)
          unwatch()
        }
        $('[data-next]', page).addEventListener('click', () => void go(4))
        wire()
      } else {
        page.innerHTML = `${mark(40)}<h1 class="title">Radio check, loud and clear</h1>
<p class="muted">Start F1 23 with UDP telemetry on (port 20777) and drive anything. I work out the mode, session, track and car myself. If I can’t, I’ll ask once, on screen, never on the radio.</p>
<div class="row" style="margin-top: 8px"><button class="gp-button gp-button--primary" data-next>Open GP</button></div>`
        $('[data-next]', page).addEventListener('click', () => void finish())
      }
    }
    const finish = async () => {
      stop?.()
      await leave(l)
      resolve()
    }
    void go(0)
  })
}
