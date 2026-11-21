import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, SettingsStore, cleanSettings } from './settings.ts'

describe('settings', () => {
  it('drops unknown or invalid values', () => {
    expect(
      cleanSettings({ radio: { chattiness: 'loud', encouragement: false }, keepRecordings: 3 }),
    ).toEqual({
      radio: { ...DEFAULT_SETTINGS.radio, encouragement: false },
      keepRecordings: 2,
    })
  })

  it('merges partial changes and survives a reopen', () => {
    const home = mkdtempSync(join(tmpdir(), 'gp-settings-'))
    const s = new SettingsStore(home)
    s.set({ radio: { chattiness: 'quiet' } })
    s.set({ keepRecordings: 0, radio: { callLostPlaces: false } })
    const again = new SettingsStore(home).get()
    expect(again.radio).toMatchObject({ chattiness: 'quiet', callLostPlaces: false })
    expect(again.keepRecordings).toBe(0)
    expect(JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')).keepRecordings).toBe(0)
  })
})
