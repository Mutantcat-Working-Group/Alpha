import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertDesktopHostPackageFiles,
  selectDesktopPackageClosure,
  type PackedDesktopPackage,
} from '../scripts/prepare-package-set.ts'

function packed(name: string, manifest: Record<string, unknown> = {}): PackedDesktopPackage {
  return { tarball: `${name}.tgz`, manifest: { name, version: '1.0.0', ...manifest } }
}

describe('desktop package-set selection', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does not select a packaging target when imported as a library', async () => {
    vi.stubEnv('DSH_DESKTOP_TARGET_PLATFORM', 'linux')
    vi.stubEnv('DSH_DESKTOP_TARGET_ARCH', 'x64')
    vi.resetModules()
    await expect(import('../scripts/prepare-package-set.ts')).resolves.toHaveProperty('prepareDesktopPackageSet')
  })

  it('includes only the available internal production closure', () => {
    const available = new Map<string, PackedDesktopPackage>([
      ['@mutantcat/dsh', packed('@mutantcat/dsh', {
        dependencies: { '@mutantcat/dsh-base': '^1.0.0', external: '^2.0.0' },
        optionalDependencies: { '@mutantcat/platform-package': '1.0.0', '@mutantcat/missing-platform': '1.0.0' },
      })],
      ['@mutantcat/dsh-desktop-host', packed('@mutantcat/dsh-desktop-host', {
        dependencies: { '@mutantcat/dsh': '^1.0.0' },
      })],
      ['@mutantcat/dsh-base', packed('@mutantcat/dsh-base', {
        peerDependencies: { '@mutantcat/cordis': '^1.0.0' },
      })],
      ['@mutantcat/cordis', packed('@mutantcat/cordis')],
      ['@mutantcat/platform-package', packed('@mutantcat/platform-package')],
      ['@mutantcat/unused', packed('@mutantcat/unused')],
    ])
    expect(selectDesktopPackageClosure(available).map(entry => entry.manifest.name)).toEqual([
      '@mutantcat/cordis',
      '@mutantcat/dsh',
      '@mutantcat/dsh-base',
      '@mutantcat/dsh-desktop-host',
      '@mutantcat/platform-package',
    ])
  })

  it.each([
    '@mutantcat/dsh-base', '@mutantcat/cordis', '@mutantcat/node-addon-system',
  ])('rejects required prepared package %s absent from the packed release inputs', (dependency) => {
    const available = new Map<string, PackedDesktopPackage>([
      ['@mutantcat/dsh', packed('@mutantcat/dsh', {
        dependencies: { [dependency]: '^1.0.0' },
      })],
      ['@mutantcat/dsh-desktop-host', packed('@mutantcat/dsh-desktop-host', {
        dependencies: { '@mutantcat/dsh': '^1.0.0' },
      })],
    ])
    expect(() => selectDesktopPackageClosure(available)).toThrow(/unpacked package/u)
    expect(() => selectDesktopPackageClosure(new Map([
      ['@mutantcat/dsh', packed('@mutantcat/dsh')],
    ]))).toThrow(/omit @mutantcat\/dsh-desktop-host/u)
  })

  it('leaves independently published Office packages to npm resolution', () => {
    const available = new Map<string, PackedDesktopPackage>([
      ['@mutantcat/dsh', packed('@mutantcat/dsh', {
        dependencies: {
          '@deepseek-ai/libreoffice-kit': '0.0.1',
          '@deepseek-ai/libreoffice-kit-wasm': '0.0.1',
        },
      })],
      ['@mutantcat/dsh-desktop-host', packed('@mutantcat/dsh-desktop-host')],
    ])
    expect(selectDesktopPackageClosure(available).map(entry => entry.manifest.name)).toEqual([
      '@mutantcat/dsh', '@mutantcat/dsh-desktop-host',
    ])
  })

  it('requires the Desktop Host entry', () => {
    const files = [
      'package/lib/index.js',
    ]
    expect(() => {
      assertDesktopHostPackageFiles(files)
    }).not.toThrow()
    expect(() => {
      assertDesktopHostPackageFiles(files.slice(1))
    }).toThrow(/lib\/index\.js/u)
  })
})
