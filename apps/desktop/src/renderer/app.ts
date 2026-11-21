import { RadioPlayer } from './audio.ts'
import { chatPage } from './pages/chat.ts'
import { debriefPage } from './pages/debrief.ts'
import { notesPage } from './pages/notes.ts'
import { settingsPage } from './pages/settings.ts'
import { statusPage } from './pages/status.ts'
import { mountShell } from './shell.ts'
import { startup } from './startup.ts'
import { gp, set, startStatusPolling } from './store.ts'
import { applySkin } from './text.ts'

// This window plays GP's voice (it owns the Web Audio radio chain), so audio comes first and
// never waits on the UI.
const player = new RadioPlayer()
gp().onAudio((m) => player.handle(m))
// GP's voice level to the overlay radio card, only while it talks (and a second after, so the
// card sees it go quiet).
let loudAt = 0
setInterval(() => {
  const l = player.level()
  if (l > 0.01) loudAt = Date.now()
  if (Date.now() - loudAt < 1_000) gp().radioLevel(Math.round(l * 100) / 100)
}, 66)

gp().onSnapshot((snapshot) => set({ snapshot }))
gp().onUpdate((update) => set({ update }))
void gp()
  .appInfo()
  .then((app) => set({ app }))
void applySkin(() => gp().skinCss())
startStatusPolling()

const root = document.getElementById('root')!
// The shell is in the page from the start (under the splash), so the version label is there
// for the packaged-app self-check straight away.
const shell = mountShell(root, {
  debrief: debriefPage,
  chat: chatPage,
  status: statusPage,
  notes: notesPage,
  settings: settingsPage,
})
shell.go('debrief')
const shellLayer = root.querySelector<HTMLElement>('.gp-shell')!
shellLayer.classList.add('is-under')

void startup(root).then((exit) => {
  if (exit.to === 'settings') shell.go('settings', 'checks')
  shellLayer.classList.remove('is-under')
  // Re-run the page's entrance now that it's visible.
  shell.go(shell.current(), exit.to === 'settings' ? 'checks' : undefined)
})
