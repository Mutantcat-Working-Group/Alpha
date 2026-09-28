import { describe, expect, it } from 'vitest'
import { parseCiPackageInvocation, resolveCiPackageTarget } from '../scripts/ci-package.ts'

describe('ci package target', () => {
  it('maps each release target to its platform and architecture', () => {
    expect(resolveCiPackageTarget('mac-arm64', 'darwin', 'arm64')).toEqual({
      name: 'mac-arm64', platform: 'darwin', arch: 'arm64',
    })
    expect(resolveCiPackageTarget('mac-x64', 'darwin', 'x64')).toEqual({
      name: 'mac-x64', platform: 'darwin', arch: 'x64',
    })
    expect(resolveCiPackageTarget('win-x64', 'win32', 'x64')).toEqual({
      name: 'win-x64', platform: 'win32', arch: 'x64',
    })
    expect(resolveCiPackageTarget('linux-x64', 'linux', 'x64')).toEqual({
      name: 'linux-x64', platform: 'linux', arch: 'x64',
    })
    expect(resolveCiPackageTarget('linux-arm64', 'linux', 'arm64')).toEqual({
      name: 'linux-arm64', platform: 'linux', arch: 'arm64',
    })
  })

  it('packages the host target when none is named', () => {
    expect(parseCiPackageInvocation([], 'darwin', 'arm64').name).toBe('mac-arm64')
    expect(parseCiPackageInvocation([], 'darwin', 'x64').name).toBe('mac-x64')
    expect(parseCiPackageInvocation([], 'win32', 'x64').name).toBe('win-x64')
    expect(parseCiPackageInvocation([], 'linux', 'x64').name).toBe('linux-x64')
    expect(parseCiPackageInvocation(['linux-arm64'], 'linux', 'arm64').name).toBe('linux-arm64')
  })

  it('rejects a target the host cannot execute', () => {
    // The bundled Node runtime must execute on the build host, so a
    // cross-platform or cross-architecture request cannot produce a working installer.
    expect(() => resolveCiPackageTarget('linux-x64', 'darwin', 'arm64')).toThrow(/linux build host/u)
    expect(() => resolveCiPackageTarget('mac-x64', 'linux', 'x64')).toThrow(/darwin build host/u)
    expect(() => resolveCiPackageTarget('mac-arm64', 'darwin', 'x64')).toThrow(/arm64 build host/u)
    expect(() => resolveCiPackageTarget('sunos-x64', 'linux', 'x64')).toThrow(/unsupported target/u)
    expect(() => parseCiPackageInvocation(['mac-arm64', 'mac-x64'], 'darwin', 'arm64'))
      .toThrow(/at most one target/u)
  })
})
