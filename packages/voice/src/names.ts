/**
 * Snap misheard driver names to the grid ("for stapen" -> "Verstappen"). STT models don't
 * know F1 names; Phase 0 showed none got "Verstappen" right from Rohit's voice.
 */
const COMMON = new Set(
  'about after again also another around because before behind being better between could doing going gonna great inside mirror normal really right should something still their there these thing think those through tyres under where which while would'.split(
    ' ',
  ),
)

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
}

export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[b.length]!
}

/** Title-case a game name ("VERSTAPPEN" -> "Verstappen"). */
export function displayName(name: string): string {
  return name.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase())
}

/**
 * Replace words (or two-word runs) that are close to a driver's name. Conservative: only
 * words of 4+ letters, not common English words, within ~30% edit distance.
 */
export function fixDriverNames(text: string, names: string[]): string {
  const targets = names
    .map((n) => ({ display: displayName(n), key: norm(n) }))
    .filter((t) => t.key.length >= 4)
  if (!targets.length) return text
  const words = text.split(/(\s+)/)
  const best = (cand: string) => {
    const k = norm(cand)
    if (k.length < 4 || COMMON.has(k)) return null
    let hit: { display: string; d: number } | null = null
    for (const t of targets) {
      if (k === t.key) return { display: t.display, d: 0 }
      const d = editDistance(k, t.key)
      if (d <= Math.max(1, Math.floor(t.key.length * 0.3)) && (!hit || d < hit.d))
        hit = { display: t.display, d }
    }
    return hit
  }
  const out: string[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!
    if (/^\s+$/.test(w) || !w) {
      out.push(w)
      continue
    }
    const trail = w.match(/[^\p{L}]+$/u)?.[0] ?? ''
    // Try joining with the next word ("for stappen") when neither word is a name on its own.
    const next = words[i + 2]
    if (next && !/^\s+$/.test(next)) {
      const pair = best(`${w}${next}`)
      const single = best(next)
      if (pair && !best(w) && (!single || pair.d < single.d)) {
        out.push(pair.display + (next.match(/[^\p{L}]+$/u)?.[0] ?? ''))
        i += 2
        continue
      }
    }
    const one = best(w)
    out.push(one ? one.display + trail : w)
  }
  return out.join('')
}

/** First names and nicknames for the 2023 grid, so "gap to Max" is understood and STT is primed. */
const FIRST_NAMES: Record<string, string[]> = {
  verstappen: ['Max'],
  perez: ['Checo', 'Sergio'],
  hamilton: ['Lewis'],
  russell: ['George'],
  leclerc: ['Charles'],
  sainz: ['Carlos'],
  norris: ['Lando'],
  piastri: ['Oscar'],
  alonso: ['Fernando'],
  stroll: ['Lance'],
  gasly: ['Pierre'],
  ocon: ['Esteban'],
  albon: ['Alex'],
  sargeant: ['Logan'],
  tsunoda: ['Yuki'],
  devries: ['Nyck'],
  ricciardo: ['Daniel'],
  lawson: ['Liam'],
  bottas: ['Valtteri'],
  zhou: ['Guanyu'],
  magnussen: ['Kevin', 'K-Mag'],
  hulkenberg: ['Nico', 'Hulk'],
}

export function firstNamesFor(names: string[]): string[] {
  return names.flatMap((n) => FIRST_NAMES[norm(n)] ?? [])
}

/** Common radio phrases that STT gets wrong ("gap 2 Max" -> "gap to Max"). */
export function fixRadioPhrases(text: string): string {
  return text
    .replace(/\b(gap|get|cap)\s+(2|two|too)\b/gi, 'gap to')
    .replace(/\b[Gg]et to\b(?=\s+[A-Z])/g, 'gap to')
    .replace(/\bbocks\b/gi, 'box')
}
