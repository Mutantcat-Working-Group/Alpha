import { describe, expect, it } from 'vitest'
import type { NpmPackageLock, RegistryIndex } from './benchmark-npm-resolution.ts'
import {
  assertDualDshInstallLayout,
  buildDualDshRegistry,
} from './verify-npm-install-layout.ts'

function validLayout(): NpmPackageLock {
  return {
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { '@mutantcat/dsh': '0.2.0', 'dsh-previous': 'npm:@mutantcat/dsh@0.1.0' } },
      'node_modules/@mutantcat/cordis': { version: '4.0.1' },
      'node_modules/@mutantcat/dsh': {
        version: '0.2.0',
        dependencies: { '@mutantcat/dsh-child': '^0.2.0' },
        peerDependencies: { '@mutantcat/cordis': '^4.0.1' },
      },
      'node_modules/@mutantcat/dsh-child': {
        version: '0.2.0',
        dependencies: { '@mutantcat/dsh-leaf': '^0.2.0' },
      },
      'node_modules/@mutantcat/dsh-leaf': { version: '0.2.0' },
      'node_modules/dsh-previous': {
        name: '@mutantcat/dsh',
        version: '0.1.0',
        dependencies: { '@mutantcat/dsh-child': '^0.1.0' },
        peerDependencies: { '@mutantcat/cordis': '^4.0.1' },
      },
      'node_modules/dsh-previous/node_modules/@mutantcat/dsh-child': {
        version: '0.1.0',
        dependencies: { '@mutantcat/dsh-leaf': '^0.1.0' },
      },
      'node_modules/dsh-previous/node_modules/@mutantcat/dsh-leaf': { version: '0.1.0' },
    },
  }
}

describe('npm install layout verifier', () => {
  it('creates two incompatible versions of every DSH package', () => {
    const index: RegistryIndex = new Map([
      ['@mutantcat/dsh', new Map([['0.1.1-rc.2', {
        name: '@mutantcat/dsh',
        version: '0.1.1-rc.2',
        dependencies: { '@mutantcat/dsh-child': '^0.1.1-rc.2' },
        peerDependencies: { '@mutantcat/cordis': '^4.0.1' },
      }]])],
      ['@mutantcat/dsh-child', new Map([['0.1.1-rc.2', {
        name: '@mutantcat/dsh-child',
        version: '0.1.1-rc.2',
      }]])],
      ['@mutantcat/cordis', new Map([['4.0.1', {
        name: '@mutantcat/cordis',
        version: '4.0.1',
      }]])],
    ])

    const dual = buildDualDshRegistry(index, '0.1.1-rc.2')

    expect([...dual.get('@mutantcat/dsh')?.keys() ?? []]).toEqual(['0.1.0', '0.2.0'])
    expect(dual.get('@mutantcat/dsh')?.get('0.1.0')).toMatchObject({
      version: '0.1.0',
      dependencies: { '@mutantcat/dsh-child': '^0.1.0' },
      peerDependencies: { '@mutantcat/cordis': '^4.0.1' },
    })
    expect(dual.get('@mutantcat/dsh')?.get('0.2.0')).toMatchObject({
      version: '0.2.0',
      dependencies: { '@mutantcat/dsh-child': '^0.2.0' },
    })
    expect(dual.get('@mutantcat/cordis')).toBe(index.get('@mutantcat/cordis'))
  })

  it('accepts isolated DSH releases with one shared Cordis installation', () => {
    expect(assertDualDshInstallLayout(validLayout())).toEqual({
      dshPackagesPerVersion: 3,
      checkedDshEdges: 4,
    })
  })

  it.each([
    ['react', 'node_modules/react'],
    ['react-dom', 'node_modules/react-dom'],
    ['react', 'node_modules/dsh-previous/node_modules/react'],
    ['react-dom', 'node_modules/dsh-previous/node_modules/react-dom'],
  ])('rejects browser runtime %s installed at %s in the DSH-only consumer', (name, path) => {
    const layout = validLayout()
    const packages = { ...layout.packages, [path]: { version: '18.3.1' } }
    expect(() => assertDualDshInstallLayout({ ...layout, packages })).toThrow(
      `${path}: ${name} is a browser build input`,
    )
  })

  it('rejects an internal edge that crosses release versions', () => {
    const layout = validLayout()
    const packages = { ...layout.packages }
    Reflect.deleteProperty(packages, 'node_modules/dsh-previous/node_modules/@mutantcat/dsh-leaf')

    expect(() => assertDualDshInstallLayout({ ...layout, packages })).toThrow(
      'node_modules/dsh-previous/node_modules/@mutantcat/dsh-child: dependencies '
      + '@mutantcat/dsh-leaf resolves to node_modules/@mutantcat/dsh-leaf@0.2.0, expected 0.1.0',
    )
  })

  it('rejects a second Cordis installation', () => {
    const layout = validLayout()
    const packages = {
      ...layout.packages,
      'node_modules/dsh-previous/node_modules/@mutantcat/cordis': { version: '4.0.1' },
    }

    expect(() => assertDualDshInstallLayout({ ...layout, packages })).toThrow(
      'expected one shared @mutantcat/cordis',
    )
  })
})
