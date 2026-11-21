import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_RADIO_PREFS, type RadioPrefs } from '@gp/engineer'

/**
 * App settings the driver changes in Settings (Radio and Data tabs), kept in
 * <home>/settings.json. Env vars still win where they existed before (GP_KEEP_RECORDINGS).
 */
export interface AppSettings {
  radio: RadioPrefs
  /** Raw recordings kept on this Mac after they're read into the history: 0, 2 or 5. */
  keepRecordings: 0 | 2 | 5
}

export const DEFAULT_SETTINGS: AppSettings = { radio: DEFAULT_RADIO_PREFS, keepRecordings: 2 }

const CHATTINESS = new Set(['quiet', 'normal', 'chatty'])

/** Keep only known keys with valid values; anything else falls back to the default. */
export function cleanSettings(raw: unknown, base: AppSettings = DEFAULT_SETTINGS): AppSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const radio = (r.radio && typeof r.radio === 'object' ? r.radio : {}) as Record<string, unknown>
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  const keep = Number(r.keepRecordings)
  return {
    radio: {
      chattiness: CHATTINESS.has(radio.chattiness as string)
        ? (radio.chattiness as RadioPrefs['chattiness'])
        : base.radio.chattiness,
      callsInCorners: bool(radio.callsInCorners, base.radio.callsInCorners),
      encouragement: bool(radio.encouragement, base.radio.encouragement),
      callLostPlaces: bool(radio.callLostPlaces, base.radio.callLostPlaces),
    },
    keepRecordings: keep === 0 || keep === 2 || keep === 5 ? keep : base.keepRecordings,
  }
}

export class SettingsStore {
  private current: AppSettings
  private readonly file: string

  constructor(home: string) {
    this.file = join(home, 'settings.json')
    let raw: unknown = {}
    try {
      if (existsSync(this.file)) raw = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch (e) {
      console.error('[settings] unreadable, using defaults:', (e as Error).message)
    }
    this.current = cleanSettings(raw)
  }

  get(): AppSettings {
    return structuredClone(this.current)
  }

  /** Merge a partial change (radio fields can be partial too) and save. */
  set(patch: { radio?: Partial<RadioPrefs>; keepRecordings?: number }): AppSettings {
    const next = cleanSettings(
      {
        ...this.current,
        ...patch,
        radio: { ...this.current.radio, ...(patch.radio ?? {}) },
      },
      this.current,
    )
    this.current = next
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`)
    renameSync(tmp, this.file)
    return this.get()
  }
}
