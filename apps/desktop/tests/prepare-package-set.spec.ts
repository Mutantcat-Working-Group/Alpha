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
      ['@mutantcat/alpha', packed('@mutantcat/alpha', {
        dependencies: { '@mutantcat/dsh-base': '^1.0.0', external: '^2.0.0' },
        optionalDependencies: { '@mutantcat/platform-package': '1.0.0', '@mutantcat/missing-platform': '1.0.0' },
      })],
      ['@mutantcat/dsh-desktop-host', packed('@mutantcat/dsh-desktop-host', {
        dependencies: { '@mutantcat/alpha': '^1.0.0' },
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
      '@mutantcat/alpha',
      '@mutantcat/dsh-base',
      '@mutantcat/dsh-desktop-host',
      '@mutantcat/platform-package',
    ])
  })

  it.each([
    '@mutantcat/dsh-base', '@mutantcat/cordis', '@mutantcat/node-addon-system',
  ])('rejects required prepared package %s absent from the packed release inputs', (dependency) => {
    const available = new Map<string, PackedDesktopPackage>([
      ['@mutantcat/alpha', packed('@mutantcat/alpha', {
        dependencies: { [dependency]: '^1.0.0' },
      })],
      ['@mutantcat/dsh-desktop-host', packed('@mutantcat/dsh-desktop-host', {
        dependencies: { '@mutantcat/alpha': '^1.0.0' },
      })],
    ])
    expect(() => selectDesktopPackageClosure(available)).toThrow(/unpacked package/u)
    expect(() => selectDesktopPackageClosure(new Map([
      ['@mutantcat/alpha', packed('@mutantcat/alpha')],
    ]))).toThrow(/omit @mutantcat\/dsh-desktop-host/u)
  })

  it('leaves independently published Office packages to npm resolution', () => {
    const available = new Map<string, PackedDesktopPackage>([
      ['@mutantcat/alpha', packed('@mutantcat/alpha', {
        dependencies: {
          '@deepseek-ai/libreoffice-kit': '0.0.1',
          '@deepseek-ai/libreoffice-kit-wasm': '0.0.1',
        },
      })],
      ['@mutantcat/dsh-desktop-host', packed('@mutantcat/dsh-desktop-host')],
    ])
    expect(selectDesktopPackageClosure(available).map(entry => entry.manifest.name)).toEqual([
      '@mutantcat/alpha', '@mutantcat/dsh-desktop-host',
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

  it('selects the native platform package the runtime resolves and skips the others', () => {
    // Reproduces the missing-addon release: the entry declares every platform
    // package optionally, but only the target's tarball is packed.
    const systemEntry = packed('@mutantcat/node-addon-system', {
      optionalDependencies: {
        '@mutantcat/node-addon-system-darwin-arm64': '0.1.2',
        '@mutantcat/node-addon-system-darwin-x64': '0.1.2',
        '@mutantcat/node-addon-system-linux-arm64': '0.1.2',
        '@mutantcat/node-addon-system-linux-x64': '0.1.2',
      },
    })
    const roots = [
      ['@mutantcat/alpha', packed('@mutantcat/alpha', {
        dependencies: { '@mutantcat/node-addon-system': '0.1.2' },
      })],
      ['@mutantcat/dsh-desktop-host', packed('@mutantcat/dsh-desktop-host')],
      ['@mutantcat/node-addon-system', systemEntry],
    ] as const
    expect(selectDesktopPackageClosure(new Map([...roots])).map(packed => packed.manifest.name)).toEqual([
      '@mutantcat/alpha', '@mutantcat/dsh-desktop-host', '@mutantcat/node-addon-system',
    ])
    expect(selectDesktopPackageClosure(new Map([
      ...roots, ['@mutantcat/node-addon-system-darwin-arm64', packed('@mutantcat/node-addon-system-darwin-arm64')],
    ])).map(packed => packed.manifest.name)).toEqual([
      '@mutantcat/alpha', '@mutantcat/dsh-desktop-host', '@mutantcat/node-addon-system',
      '@mutantcat/node-addon-system-darwin-arm64',
    ])
  })
})
