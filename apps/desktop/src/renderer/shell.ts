import { type AppInfo, type StatusInfo, type UpdateState, versionLabel } from '../ipc.ts'
import { $, ago, clock, esc, gpMarkNav, icon, setHtml } from './dom.ts'
import { type AppState, get, gp, watch } from './store.ts'

export type PageId = 'debrief' | 'chat' | 'status' | 'notes' | 'settings'

/** A page draws into `root` and returns its cleanup. `arg` deep-links (a Settings tab). */
export type Page = (root: HTMLElement, arg?: string) => (() => void) | undefined

const NAV: [PageId, string, Parameters<typeof icon>[0]][] = [
  ['debrief', 'Debrief', 'debrief'],
  ['chat', 'Ask GP', 'chat'],
  ['status', 'Status', 'status'],
  ['notes', 'Notes', 'notes'],
  ['settings', 'Settings', 'settings'],
]

export interface Shell {
  go(page: PageId, arg?: string): void
  current(): PageId
}

/**
 * The app window: side nav (mark, pages, clock, last drove, version), top bar with the one
 * status line, banners, and the scrolling page. Pages rise in when you change them.
 */
export function mountShell(root: HTMLElement, pages: Record<PageId, Page>): Shell {
  const shell = document.createElement('div')
  shell.className = 'layer gp-shell gp-fade-in'
  shell.innerHTML = `<nav class="gp-nav" aria-label="GP">
<div class="gp-nav-brand">${gpMarkNav()}GP</div>
${NAV.map(([id, label, ic]) => `<button class="gp-nav-item" data-page="${id}">${icon(ic)}${label}<span class="gp-dot hidden" data-dot></span></button>`).join('')}
<div class="gp-nav-foot"><span data-clock></span><span data-last></span><span id="ver" title="GP version"></span></div>
</nav>
<div class="gp-main">
<div class="gp-topbar"><span class="gp-statusline" data-statusline aria-live="polite"></span><span class="spacer"></span><span data-top></span></div>
<div class="gp-content" data-content><div class="banners" data-banners></div><div data-page-root></div></div>
</div>`
  root.append(shell)

  const content = $('[data-content]', shell)
  const pageRoot = $('[data-page-root]', shell)
  let current: PageId = 'debrief'
  let cleanup: (() => void) | undefined
  const go = (id: PageId, arg?: string) => {
    cleanup?.()
    current = id
    for (const b of shell.querySelectorAll<HTMLElement>('[data-page]')) {
      if (b.dataset.page === id) b.setAttribute('aria-current', 'page')
      else b.removeAttribute('aria-current')
    }
    pageRoot.innerHTML = ''
    pageRoot.className = id === 'debrief' || id === 'chat' ? 'page-fill' : ''
    content.classList.toggle('is-fill', id === 'debrief' || id === 'chat')
    content.scrollTop = 0
    cleanup = pages[id](pageRoot, arg)
  }
  for (const b of shell.querySelectorAll<HTMLElement>('[data-page]'))
    b.addEventListener('click', () => go(b.dataset.page as PageId))

  // Nav foot: today's date and time, when you last drove, the version.
  const tick = () => {
    $('[data-clock]', shell).textContent = clock()
  }
  tick()
  setInterval(tick, 15_000)
  const lastDrove = async () => {
    const [s] = await gp()
      .sessions({ limit: 1 })
      .catch(() => [])
    $('[data-last]', shell).textContent = s ? `Last drove ${ago(s.startedAt)}` : 'No sessions yet'
  }
  void lastDrove()
  setInterval(() => void lastDrove(), 60_000)

  watch(['app'], ({ app }) => {
    if (app) $('#ver', shell).textContent = `GP ${versionLabel(app as AppInfo)}`
  })
  watch(['snapshot', 'status'], (s) => {
    setHtml($('[data-statusline]', shell), statusLine(s))
    const st = s.status
    // A dot on Status when something needs you, red when it's broken.
    const need = st ? needs(st) : { bad: false, warn: false }
    const dot = shell.querySelector<HTMLElement>('[data-page="status"] [data-dot]')!
    dot.className = `gp-dot ${need.bad ? 'gp-dot--bad' : 'gp-dot--warn'}${need.bad || need.warn ? '' : ' hidden'}`
    const sdot = shell.querySelector<HTMLElement>('[data-page="settings"] [data-dot]')!
    sdot.className = `gp-dot gp-dot--warn${st && !st.secrets.configured ? '' : ' hidden'}`
  })
  const banners = $('[data-banners]', shell)
  const top = $('[data-top]', shell)
  let dismissed = new Set<string>()
  watch(['update', 'status'], (s) => {
    const list = bannerList(s, (id) => !dismissed.has(id))
    if (setHtml(banners, list.map((b) => b.html).join('')))
      for (const btn of banners.querySelectorAll<HTMLElement>('[data-act]'))
        btn.addEventListener('click', () => {
          const [act, id] = btn.dataset.act!.split(':') as [string, string]
          if (act === 'dismiss') {
            dismissed = new Set([...dismissed, id])
            btn.closest('.gp-banner')?.remove()
            banners.dataset.html = banners.innerHTML
          } else if (act === 'install') void install()
          else if (act === 'go') go(id as PageId, btn.dataset.arg)
        })
    const ready = s.update?.phase === 'ready'
    if (
      setHtml(
        top,
        ready
          ? '<button class="gp-button gp-button--sm gp-pop" data-install><span class="gp-dot gp-dot--good"></span>Restart to update</button>'
          : '',
      )
    )
      top.querySelector('[data-install]')?.addEventListener('click', () => void install())
  })

  return { go, current: () => current }
}

/** Quits, installs and reopens; says why when it can't (for example while you're driving). */
export async function install(): Promise<void> {
  const why = await gp().installUpdate()
  if (why) {
    const u = get().update
    if (u) window.dispatchEvent(new CustomEvent('gp:update-refused', { detail: why }))
  }
}

function needs(st: StatusInfo): { bad: boolean; warn: boolean } {
  const sec = st.secrets
  const bad = (sec.configured && sec.source === 'none') || !!st.database.error
  const warn =
    !sec.configured ||
    sec.source === 'cache' ||
    !st.controller.connected ||
    (st.database.configured &&
      st.database.pending > 0 &&
      !!st.database.oldestPendingAt &&
      Date.now() - Date.parse(st.database.oldestPendingAt) > 86_400_000)
  return { bad, warn }
}

/** What GP is doing right now, in one line. */
function statusLine({ snapshot, status }: AppState): string {
  const race = snapshot?.race
  const live = status?.game.receiving ?? race?.status === 'live'
  if (live && race?.session) {
    const me = race.cars.find((c) => c.isPlayer)
    const s = race.session
    const lap = me && s.totalLaps ? `lap ${me.currentLap} of ${s.totalLaps}` : ''
    const mode = status?.game.mode
    const bits = [mode, s.track, s.sessionType, lap].filter(Boolean).map((x) => esc(String(x)))
    return `<span class="gp-dot gp-dot--live gp-dot--pulse"></span><b>On track</b> · ${bits.join(' · ')} · radio live`
  }
  const sec = status?.secrets
  if (sec?.configured && sec.source === 'cache')
    return '<span class="gp-dot gp-dot--warn"></span>Offline · radio works on cached secrets'
  if (sec?.configured && sec.source === 'none')
    return '<span class="gp-dot gp-dot--bad"></span>No secrets · fix Infisical in Settings'
  return '<span class="gp-dot"></span>Waiting for F1 23 · radio ready'
}

interface Banner {
  id: string
  html: string
}

function bannerList({ update, status }: AppState, show: (id: string) => boolean): Banner[] {
  const out: Banner[] = []
  const b = (id: string, dot: string, text: string, actions: string) =>
    show(id) &&
    out.push({
      id,
      html: `<div class="gp-banner gp-enter" role="status"><span class="gp-dot ${dot}"></span><span class="gp-banner-text">${text}</span>${actions}</div>`,
    })
  const u = update as UpdateState | null
  if (u?.phase === 'ready')
    b(
      'update',
      'gp-dot--good',
      `<b>GP ${esc(u.version ?? '')} is ready.</b> Restart when you're not driving. It takes about five seconds.`,
      '<button class="gp-button gp-button--sm gp-button--primary" data-act="install:">Restart to update</button>',
    )
  else if (u?.message?.startsWith('Updated'))
    b(
      'updated',
      'gp-dot--good',
      `<b>${esc(u.message)}</b>`,
      '<button class="gp-button gp-button--sm gp-button--ghost" data-act="dismiss:updated">Dismiss</button>',
    )
  const sec = status?.secrets
  if (sec?.configured && sec.source === 'cache')
    b(
      'offline',
      'gp-dot--warn',
      `<b>Can't reach Infisical.</b> The radio runs on cached secrets${sec.fetchedAt ? ` from ${esc(new Date(sec.fetchedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}` : ''}. ${esc(sec.error ?? '')}`,
      '<button class="gp-button gp-button--sm" data-act="go:status">Status</button>',
    )
  if (sec?.configured && sec.source === 'none')
    b(
      'secrets',
      'gp-dot--bad',
      `<b>Infisical refused GP's credentials.</b> ${esc(sec.error ?? '')}`,
      '<button class="gp-button gp-button--sm" data-act="go:settings" data-arg="connections">Open Connections</button>',
    )
  if (status?.database.configured && status.database.error)
    b(
      'db',
      'gp-dot--warn',
      `<b>Can't reach Postgres.</b> New sessions wait on this Mac and sync when it's back. Nothing is lost.`,
      '<button class="gp-button gp-button--sm" data-act="go:status">Status</button>',
    )
  return out
}
