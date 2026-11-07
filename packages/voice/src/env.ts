import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** GP's data folder: notes, recordings, keys. Outside the repo on purpose. */
export function gpHome(): string {
  return process.env.GP_HOME ?? join(homedir(), 'Documents', 'GP')
}

/**
 * Load KEY=value lines from <gpHome>/.env into process.env (existing env wins).
 * Only this one file is read. Returns its path, or null if it doesn't exist.
 */
export function loadDotEnv(home = gpHome()): string | null {
  const path = join(home, '.env')
  if (!existsSync(path)) return null
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line
      .slice(0, eq)
      .replace(/^export\s+/, '')
      .trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1)
    if (process.env[key] === undefined) process.env[key] = value
  }
  return path
}
