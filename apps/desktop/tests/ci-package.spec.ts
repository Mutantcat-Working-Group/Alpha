import { describe, expect, it } from 'vitest'
import { parseCiPackageInvocation, resolveCiPackageTarget } from '../scripts/ci-package.ts'

describe('ci package target', () => {
  it('selects the electron-builder selectors that match each release target', () => {
    expect(resolveCiPackageTarget('mac-arm64', 'darwin', 'arm64')).toMatchObject({
      platform: 'darwin', arch: 'arm64', builderPlatform: '--mac', builderArch: '--arm64',
    })
    expect(resolveCiPackageTarget('mac-x64', 'darwin', 'x64')).toMatchObject({
      platform: 'darwin', arch: 'x64', builderPlatform: '--mac', builderArch: '--x64',
    })
    expect(resolveCiPackageTarget('win-x64', 'win32', 'x64')).toMatchObject({
      platform: 'win32', arch: 'x64', builderPlatform: '--win', builderArch: '--x64',
    })
    expect(resolveCiPackageTarget('linux-x64', 'linux', 'x64')).toMatchObject({
      platform: 'linux', arch: 'x64', builderPlatform: '--linux', builderArch: '--x64',
    })
    expect(resolveCiPackageTarget('linux-arm64', 'linux', 'arm64')).toMatchObject({
      platform: 'linux', arch: 'arm64', builderPlatform: '--linux', builderArch: '--arm64',
    })
  })

  it('collects the installer each platform emits', () => {
    expect(resolveCiPackageTarget('win-x64', 'win32', 'x64').artifactExtensions).toEqual(['.exe'])
    expect(resolveCiPackageTarget('mac-x64', 'darwin', 'x64').artifactExtensions).toEqual(['.dmg'])
    expect(resolveCiPackageTarget('linux-arm64', 'linux', 'arm64').artifactExtensions).toEqual(['.AppImage'])
  })

  it('packages the host target when none is named', () => {
    expect(parseCiPackageInvocation([], 'darwin', 'arm64').name).toBe('mac-arm64')
    expect(parseCiPackageInvocation([], 'darwin', 'x64').name).toBe('mac-x64')
    expect(parseCiPackageInvocation([], 'win32', 'x64').name).toBe('win-x64')
    expect(parseCiPackageInvocation([], 'linux', 'x64').name).toBe('linux-x64')
    expect(parseCiPackageInvocation(['linux-arm64'], 'linux', 'arm64').name).toBe('linux-arm64')
  })

  it('rejects a target the host cannot execute', () => {
    // Electron and the bundled dsh runtime both run on the build host, so a
    // cross-platform or cross-architecture request cannot produce a working installer.
    expect(() => resolveCiPackageTarget('linux-x64', 'darwin', 'arm64')).toThrow(/linux build host/u)
    expect(() => resolveCiPackageTarget('mac-x64', 'linux', 'x64')).toThrow(/darwin build host/u)
    expect(() => resolveCiPackageTarget('mac-arm64', 'darwin', 'x64')).toThrow(/arm64 build host/u)
    expect(() => resolveCiPackageTarget('sunos-x64', 'linux', 'x64')).toThrow(/unsupported target/u)
    expect(() => parseCiPackageInvocation(['mac-arm64', 'mac-x64'], 'darwin', 'arm64'))
      .toThrow(/at most one target/u)
  })
})

describe('ci builder config', () => {
  it.each([
    ['darwin', 'arm64', 'mac-arm64'],
    ['darwin', 'x64', 'mac-x64'],
    ['win32', 'x64', 'win-x64'],
    ['linux', 'x64', 'linux-x64'],
    ['linux', 'arm64', 'linux-arm64'],
  ] as const)('builds one credential-free %s %s installer', async (platform, arch, target) => {
    const { createCiBuilderConfig, CI_APP_ID } = await import('../scripts/ci-builder-config.mjs')
    const config = createCiBuilderConfig({ DSH_DESKTOP_TARGET_PLATFORM: platform, DSH_DESKTOP_TARGET_ARCH: arch }, platform, arch)

    expect(CI_APP_ID).toBe('org.mutantcat.alpha')
    expect(config.appId).toBe(CI_APP_ID)
    expect(config.productName).toBe('Alpha')
    expect(config.artifactName).toBe('Alpha-${version}-${os}-${arch}.${ext}')
    expect(config.directories.output).toContain(target)
    // No update feed, no mandatory-update policy, and no publishing step: the
    // release assets are the only distribution channel this build serves.
    expect(config.publish).toBeNull()
    expect(config.detectUpdateChannel).toBe(false)
    expect(config.extraMetadata).toBeUndefined()
  })

  it('emits one ad-hoc signed disk image per macOS architecture', async () => {
    const { createCiBuilderConfig } = await import('../scripts/ci-builder-config.mjs')
    for (const arch of ['arm64', 'x64'] as const) {
      const config = createCiBuilderConfig({ DSH_DESKTOP_TARGET_PLATFORM: 'darwin', DSH_DESKTOP_TARGET_ARCH: arch }, 'darwin', arch)
      expect(config.mac).toMatchObject({ target: ['dmg'], identity: '-', notarize: false, hardenedRuntime: false })
      // electron-builder skips DMG signing when the identity has no keychain
      // entry, so the finished image carries the ad-hoc signature instead.
      expect(config.dmg).toMatchObject({ sign: false, writeUpdateInfo: false })
    }
  })

  it('emits an NSIS installer without Authenticode and an AppImage without an update feed', async () => {
    const { createCiBuilderConfig } = await import('../scripts/ci-builder-config.mjs')
    const windows = createCiBuilderConfig({ DSH_DESKTOP_TARGET_PLATFORM: 'win32', DSH_DESKTOP_TARGET_ARCH: 'x64' }, 'win32', 'x64')
    expect(windows.win).toMatchObject({ target: ['nsis'], forceCodeSigning: false })
    expect(windows.win.signtoolOptions).toBeUndefined()

    const linux = createCiBuilderConfig({ DSH_DESKTOP_TARGET_PLATFORM: 'linux', DSH_DESKTOP_TARGET_ARCH: 'x64' }, 'linux', 'x64')
    expect(linux.linux).toMatchObject({ target: ['AppImage'] })
    expect(linux.mac).toMatchObject({ target: ['dmg'] })
  })

  it('keeps the packaged runtime tree identical to the official release layout', async () => {
    const { createCiBuilderConfig } = await import('../scripts/ci-builder-config.mjs')
    const config = createCiBuilderConfig({ DSH_DESKTOP_TARGET_PLATFORM: 'linux', DSH_DESKTOP_TARGET_ARCH: 'x64' }, 'linux', 'x64')

    expect(config.files).toContain('lib/main.js')
    expect(config.files).toContain('renderer/**/*')
    expect(config.asar).toBe(true)
    expect(config.asarUnpack).toContain('**/*.{node,dylib,dll,so,exe}')
    expect(config.extraResources).toEqual(expect.arrayContaining([
      expect.objectContaining({ to: 'runtime' }),
      expect.objectContaining({ to: 'icon.png' }),
    ]))
  })
})
