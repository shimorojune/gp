import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadDotEnv } from '../src/env.ts'
import { toWav } from '../src/mic.ts'
import { displayName, fixDriverNames } from '../src/names.ts'
import { DualSensePtt } from '../src/ptt.ts'
import { SentenceSplitter } from '../src/sentences.ts'

const GRID = [
  'VERSTAPPEN',
  'PÉREZ',
  'HAMILTON',
  'RUSSELL',
  'LECLERC',
  'SAINZ',
  'NORRIS',
  'PIASTRI',
  'ALONSO',
  'HÜLKENBERG',
]

describe('fixDriverNames', () => {
  it('snaps misheard names to the grid', () => {
    expect(fixDriverNames('how far is fur stappen', GRID)).toBe('how far is Verstappen')
    expect(fixDriverNames('gap to Lecler?', GRID)).toBe('gap to Leclerc?')
    expect(fixDriverNames('is hulkenberg on softs', GRID)).toBe('is Hülkenberg on softs')
    expect(fixDriverNames('perez', GRID)).toBe('Pérez')
  })
  it('leaves ordinary words alone', () => {
    expect(fixDriverNames('what about the rears, are they going', GRID)).toBe(
      'what about the rears, are they going',
    )
    expect(fixDriverNames('box this lap', GRID)).toBe('box this lap')
  })
  it('title-cases game names', () => {
    expect(displayName('DE VRIES')).toBe('De Vries')
  })
})

describe('SentenceSplitter', () => {
  it('emits sentences as they complete and keeps decimals together', () => {
    const s = new SentenceSplitter()
    expect(s.push('Gap is 1.2 to Norris. ')).toEqual(['Gap is 1.2 to Norris.'])
    expect(s.push('Copy. He is on ')).toEqual([])
    expect(s.push('mediums, eight laps old. Push')).toEqual([
      'Copy. He is on mediums, eight laps old.',
    ])
    expect(s.flush()).toBe('Push')
  })
})

describe('DualSensePtt', () => {
  it('reads the mute bit from USB and Bluetooth reports', () => {
    const usb = Buffer.alloc(64)
    usb[0] = 0x01
    usb[10] = 0x04
    const bt = Buffer.alloc(78)
    bt[0] = 0x31
    bt[11] = 0x04
    expect(DualSensePtt.isMuteDown(usb)).toBe(true)
    expect(DualSensePtt.isMuteDown(bt)).toBe(true)
    bt[11] = 0x02 // touchpad
    expect(DualSensePtt.isMuteDown(bt)).toBe(false)
    expect(DualSensePtt.isMuteDown([0x05, 0, 0])).toBeNull()
  })
})

describe('env and wav', () => {
  it('loads .env from the GP folder without overriding existing env', () => {
    const root = mkdtempSync(join(tmpdir(), 'gp-env-'))
    writeFileSync(join(root, '.env'), '# keys\nGP_TEST_A="one"\nexport GP_TEST_B=two\n')
    process.env.GP_TEST_B = 'kept'
    expect(loadDotEnv(root)).toBe(join(root, '.env'))
    expect(process.env.GP_TEST_A).toBe('one')
    expect(process.env.GP_TEST_B).toBe('kept')
  })
  it('writes a valid WAV header', () => {
    const wav = toWav(Buffer.alloc(3200))
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.readUInt32LE(24)).toBe(16000)
    expect(wav.length).toBe(3244)
  })
})
