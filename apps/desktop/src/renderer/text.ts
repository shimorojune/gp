/** GP writes pause tags for the voice; hide them (and a half-arrived one) on screen. */
export function spokenText(text: string): string {
  return text
    .replace(/<break\b[^>]*\/?>/gi, ' ')
    .replace(/<[^>]*$/, '')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/ {2,}/g, ' ')
    .trim()
}

/** Adds the local skin (fonts you own in ~/Documents/GP/skin) to this page, if there is one. */
export async function applySkin(load: () => Promise<string>): Promise<void> {
  const css = await load().catch(() => '')
  if (!css) return
  const style = document.createElement('style')
  style.id = 'gp-skin'
  style.textContent = css
  document.head.append(style)
}
