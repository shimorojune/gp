import { tokens } from './tokens.ts'

const kebab = (s: string) =>
  s
    .replace(/\./g, '-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()

/** Name of the CSS custom property for a token, e.g. cssVar('color', 'textMuted') -> --gp-color-text-muted. */
export function cssVar(group: string, key: string | number): string {
  return `--gp-${kebab(group)}-${kebab(String(key))}`
}

/** Every token as [custom property, value]. Palette primitives are left out on purpose. */
export function tokenEntries(): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const [group, values] of Object.entries(tokens)) {
    if (group === 'palette') continue
    for (const [key, value] of Object.entries(values)) {
      if (Array.isArray(value)) {
        out.push([`${cssVar(group, key)}-size`, value[0]])
        out.push([`${cssVar(group, key)}-line`, value[1]])
      } else if (typeof value === 'number') {
        out.push([cssVar(group, key), `${value}`])
      } else {
        out.push([cssVar(group, key), value])
      }
    }
  }
  return out
}

/** The `:root { --gp-*: ... }` block. */
export function tokensCss(): string {
  const lines = tokenEntries().map(([k, v]) => `  ${k}: ${v};`)
  return `:root {\n  color-scheme: dark;\n${lines.join('\n')}\n}\n`
}
