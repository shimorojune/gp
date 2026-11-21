import { mark } from '../dom.ts'

/*
 * Ask GP before its own phase lands: a pointer to the quick chat.
 */

export function chatInterim(root: HTMLElement): undefined {
  root.innerHTML = `<div class="page gp-page"><div class="gp-empty" style="margin-top: 48px">${mark(28)}<h3>Ask GP</h3><p>Chat over all your history arrives in the next update. Until then the quick chat is a keypress away: <span class="gp-kbd">⌘</span> <span class="gp-kbd">⇧</span> <span class="gp-kbd">G</span></p></div></div>`
}
