import type { NotesData } from '../../ipc.ts'
import { $, esc, mark, when } from '../dom.ts'
import { gp } from '../store.ts'

const CATS = ['driving', 'setup', 'radio', 'strategy', 'personal', 'track'] as const
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function notesPage(root: HTMLElement): () => void {
  root.innerHTML = `<div class="page gp-page">
<div class="page-head"><div><h1 class="title">Notes</h1><p class="sub">What GP has learnt about you, and what you've told it. Shared by every career and sim run.</p></div></div>
<div class="notes">
<section class="gp-panel gp-enter">
<div class="panel-head"><span class="gp-msg-avatar" style="width: 24px; height: 24px">${mark(10)}</span><h2 class="h">GP's read on you</h2><span class="spacer"></span><span class="faint" style="font-size: 12px" data-meta></span></div>
<textarea class="gp-input" data-profile rows="12" placeholder="Builds up after your first few sessions. You can write or correct it yourself."></textarea>
<div class="row" style="margin-top: 12px"><span class="faint" data-saved style="font-size: 12px"></span><span class="spacer"></span><button class="gp-button" data-save disabled>Save</button></div>
</section>
<section class="gp-panel gp-enter" style="--i: 1">
<div class="panel-head"><span class="gp-label">Your notes for GP</span><span class="spacer"></span><select class="gp-input" aria-label="Filter by track" data-filter style="height: 28px"><option value="">All notes</option></select></div>
<form class="gp-composer" data-add style="margin-bottom: 8px">
<select class="gp-input" aria-label="Kind of note" data-cat style="flex: none; width: 104px">${CATS.map((c) => `<option value="${c}">${cap(c)}</option>`).join('')}</select>
<input class="gp-input hidden" aria-label="Track" placeholder="Track" data-track style="flex: none; width: 110px">
<input class="gp-input" aria-label="New note" placeholder="Something GP should remember" data-text>
<button class="gp-button" type="submit">Add</button></form>
<div data-list></div>
</section>
</div></div>`
  const profile = $<HTMLTextAreaElement>('[data-profile]', root)
  const save = $<HTMLButtonElement>('[data-save]', root)
  const filter = $<HTMLSelectElement>('[data-filter]', root)
  const cat = $<HTMLSelectElement>('[data-cat]', root)
  const track = $<HTMLInputElement>('[data-track]', root)
  const text = $<HTMLInputElement>('[data-text]', root)
  let data: NotesData | null = null
  let savedText = ''

  const render = (d: NotesData) => {
    data = d
    if (document.activeElement !== profile || profile.value === savedText) {
      profile.value = d.profile?.text ?? ''
      savedText = profile.value
      save.disabled = true
    }
    $('[data-meta]', root).textContent = d.profile
      ? `Updated ${when(d.profile.updatedAt)} by ${d.profile.editedBy === 'driver' ? 'you' : 'GP'}`
      : ''
    const tracks = [...new Set(d.notes.map((n) => n.track).filter(Boolean) as string[])].sort()
    const keep = filter.value
    filter.innerHTML = `<option value="">All notes</option>${tracks.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}`
    filter.value = tracks.includes(keep) ? keep : ''
    const shown = d.notes.filter((n) => !filter.value || n.track === filter.value)
    $('[data-list]', root).innerHTML = shown.length
      ? shown
          .map(
            (n, i) =>
              `<div class="note" style="--i: ${i}"><span class="t">${esc(n.text)}<span class="faint" style="font-size: 12px"> · ${esc(cap(n.category))}</span></span><span class="where">${esc(n.track ?? '')}</span><span class="faint" style="font-size: 12px; width: 28px">${n.source === 'engineer' ? 'GP' : 'You'}</span><button class="gp-button gp-button--sm gp-button--ghost" data-del="${esc(n.id)}" aria-label="Delete note">Delete</button></div>`,
          )
          .join('')
      : `<div class="gp-empty" style="padding: 24px 0"><p class="muted">${filter.value ? `No notes for ${esc(filter.value)}.` : 'Nothing yet. Add something GP should keep in mind, or ask it on the radio to remember something.'}</p></div>`
  }
  const load = async () => render(await gp().notes())
  void load()

  profile.addEventListener('input', () => {
    save.disabled = profile.value === savedText
    save.classList.toggle('gp-button--primary', !save.disabled)
  })
  save.addEventListener('click', async () => {
    save.disabled = true
    const d = await gp().saveProfile(profile.value)
    savedText = profile.value
    render(d)
    save.classList.remove('gp-button--primary')
    const s = $('[data-saved]', root)
    s.textContent = 'Saved'
    setTimeout(() => {
      s.textContent = ''
    }, 2000)
  })
  filter.addEventListener('change', () => data && render(data))
  cat.addEventListener('change', () => track.classList.toggle('hidden', cat.value !== 'track'))
  $('[data-add]', root).addEventListener('submit', async (e) => {
    e.preventDefault()
    const t = text.value.trim()
    if (!t) return
    const tr = cat.value === 'track' ? track.value.trim() : ''
    render(await gp().addNote({ category: cat.value, text: t, ...(tr ? { track: tr } : {}) }))
    text.value = ''
  })
  $('[data-list]', root).addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-del]')
    if (!b) return
    if (b.dataset.sure !== '1') {
      b.dataset.sure = '1'
      b.textContent = 'Delete?'
      setTimeout(() => {
        b.dataset.sure = ''
        b.textContent = 'Delete'
      }, 3000)
      return
    }
    render(await gp().removeNote(b.dataset.del!))
  })
  return () => {}
}
