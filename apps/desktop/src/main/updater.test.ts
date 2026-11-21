import { describe, expect, it } from 'vitest'
import { compareVersions, notUpdatableReason, parseManifest } from './updater.ts'

describe('compareVersions', () => {
  it('orders x.y.z numerically', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1)
    expect(compareVersions('0.2.0', '0.2.0')).toBe(0)
    expect(compareVersions('v0.2.1', '0.3.0')).toBe(-1)
  })
  it('puts a prerelease before its release', () => {
    expect(compareVersions('0.3.0-e2e.1', '0.3.0')).toBe(-1)
    expect(compareVersions('0.3.0-e2e.2', '0.3.0-e2e.1')).toBe(1)
  })
})

describe('parseManifest', () => {
  const ok = {
    name: 'GP',
    version: '0.3.0',
    commit: 'abc',
    arch: process.arch,
    files: { zip: { name: 'GP-0.3.0-arm64.zip', size: 10, sha256: 'a'.repeat(64) } },
  }
  it('accepts a release manifest', () => {
    expect(parseManifest(ok).version).toBe('0.3.0')
  })
  it('rejects missing hashes and path tricks', () => {
    expect(() =>
      parseManifest({ ...ok, files: { zip: { ...ok.files.zip, sha256: 'x' } } }),
    ).toThrow()
    expect(() =>
      parseManifest({ ...ok, files: { zip: { ...ok.files.zip, name: '../../evil.zip' } } }),
    ).toThrow()
    expect(() => parseManifest({ ...ok, arch: 'not-this-arch' })).toThrow()
  })
})

describe('notUpdatableReason', () => {
  it('only updates an installed, packaged app', () => {
    expect(notUpdatableReason('/Applications/GP.app', true)).toBeNull()
    expect(notUpdatableReason(null, false)).toMatch(/repo/)
    expect(notUpdatableReason('/Volumes/GP 0.2.0/GP.app', true)).toMatch(/disk image/)
    expect(notUpdatableReason('/private/var/folders/x/AppTranslocation/y/d/GP.app', true)).toMatch(
      /xattr/,
    )
  })
})
