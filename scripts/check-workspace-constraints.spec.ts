/** Experimental-package publication and dependency constraints. */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  isPublicExperimentalPackageDirectory,
  PRIVATE_EXPERIMENTAL_PACKAGE_DIRECTORIES,
} from './experimental-package-policy.ts'
import {
  checkDshFamilyVersion,
  checkWorkspaceManifest,
  checkExperimentalDependencyIsolation,
  checkExperimentalManifest,
  expectedDshPackageFiles,
  type WorkspaceManifest,
} from './check-workspace-constraints.ts'

const experimental = {
  dir: 'packages/experimental/prototype',
  manifest: {
    name: '@mutantcat/dsh-experimental-prototype',
    publishConfig: { access: 'public' },
  },
} satisfies WorkspaceManifest

describe('experimental workspace constraints', () => {
  it('requires the experimental package-name prefix', () => {
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, name: '@mutantcat/dsh-prototype' },
    })).toEqual([
      '@mutantcat/dsh-prototype: experimental package name must start with "@mutantcat/dsh-experimental-"',
    ])
  })

  it('requires public metadata for unlisted experimental packages', () => {
    expect(checkExperimentalManifest(experimental)).toEqual([])
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { name: experimental.manifest.name, private: true },
    })).toEqual([
      '@mutantcat/dsh-experimental-prototype: public experimental package must not set "private": true',
      '@mutantcat/dsh-experimental-prototype: public experimental package must set publishConfig.access to "public"',
    ])
  })

  it('requires private metadata for an explicitly excluded prototype', () => {
    const { dir, manifest: { name } } = experimental
    const privateDirectories = [dir]
    expect(isPublicExperimentalPackageDirectory(dir, privateDirectories)).toBe(false)
    expect(checkExperimentalManifest({ dir, manifest: { name, private: true } }, privateDirectories)).toEqual([])
    expect(checkExperimentalManifest(experimental, privateDirectories)).toEqual([
      `${name}: experimental package must set "private": true`,
      `${name}: experimental package must omit publishConfig`,
    ])
  })

  it('keeps the current experimental publication set unrestricted', () => {
    expect(PRIVATE_EXPERIMENTAL_PACKAGE_DIRECTORIES).toEqual([])
  })

  it('limits the public default to experimental package directories', () => {
    expect(isPublicExperimentalPackageDirectory(experimental.dir)).toBe(true)
    for (const dir of [
      'packages/core/session',
      'apps/cli',
      'vendor/cordis',
      'packages/experimental',
      'packages/experimental/prototype/src',
      ...PRIVATE_EXPERIMENTAL_PACKAGE_DIRECTORIES,
    ]) {
      expect(isPublicExperimentalPackageDirectory(dir)).toBe(false)
    }
  })

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'] as const)(
    'rejects release %s on an experimental package',
    (section) => {
      expect(checkExperimentalDependencyIsolation([experimental, {
        dir: 'packages/core/consumer',
        manifest: {
          name: '@mutantcat/dsh-consumer',
          [section]: { '@mutantcat/dsh-experimental-prototype': 'workspace:^' },
        },
      }])).toEqual([
        `@mutantcat/dsh-consumer: ${section}.@mutantcat/dsh-experimental-prototype must not reference an experimental package`,
      ])
    },
  )

  it('allows the dsh installation to ship the optional bundles the launcher names, and nothing else experimental', () => {
    const listed = { '@mutantcat/dsh-experimental-prototype': 'workspace:^' }
    const installation = { dir: 'apps/cli', manifest: { name: '@mutantcat/dsh', dependencies: listed } } satisfies WorkspaceManifest
    expect(checkExperimentalDependencyIsolation([experimental, installation], ['@mutantcat/dsh-experimental-prototype'])).toEqual([])
    expect(checkExperimentalDependencyIsolation([experimental, installation], [])).toEqual([
      '@mutantcat/dsh: dependencies.@mutantcat/dsh-experimental-prototype must not reference an experimental package',
    ])
    // Only a plain dependency edge is offered; a peer would make the bundle a requirement of every consumer.
    expect(checkExperimentalDependencyIsolation([experimental, {
      dir: 'apps/cli',
      manifest: { name: '@mutantcat/dsh', peerDependencies: listed },
    }], ['@mutantcat/dsh-experimental-prototype'])).toEqual([
      '@mutantcat/dsh: peerDependencies.@mutantcat/dsh-experimental-prototype must not reference an experimental package',
    ])
  })

  it('allows development and experimental consumers but rejects the Python release runtime', () => {
    const manifests: WorkspaceManifest[] = [experimental, {
      dir: 'packages/core/test-only',
      manifest: {
        name: '@mutantcat/dsh-test-only',
        devDependencies: { '@mutantcat/dsh-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'packages/experimental/consumer',
      manifest: {
        name: '@mutantcat/dsh-experimental-consumer',
        dependencies: { '@mutantcat/dsh-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'python/sdk-runtime',
      manifest: {
        name: '@mutantcat/dsh-python-runtime',
        dependencies: { '@mutantcat/dsh-experimental-prototype': 'workspace:^' },
      },
    }]

    expect(checkExperimentalDependencyIsolation(manifests)).toEqual([
      '@mutantcat/dsh-python-runtime: dependencies.@mutantcat/dsh-experimental-prototype must not reference an experimental package',
    ])
  })
})

describe('dsh family version coherence', () => {
  it('rejects a package carrying a stale shared version', () => {
    expect(checkDshFamilyVersion(
      { name: '@mutantcat/dsh-http-proxy', version: '0.1.2-alpha.5' },
      '0.1.2-rc.1',
    )).toBe('@mutantcat/dsh-http-proxy: package.json version must match root version 0.1.2-rc.1')
  })

  it('rejects the root-named CLI app on a stale shared version', () => {
    expect(checkDshFamilyVersion(
      { name: '@mutantcat/dsh', version: '0.1.2-alpha.5' },
      '0.1.2-rc.1',
    )).toBe('@mutantcat/dsh: package.json version must match root version 0.1.2-rc.1')
  })

  it('accepts a manifest carrying the shared version', () => {
    expect(checkDshFamilyVersion(
      { name: '@mutantcat/dsh-http-proxy', version: '0.1.2-rc.1' },
      '0.1.2-rc.1',
    )).toBeUndefined()
  })

  it('leaves other sequences to their own version lines', () => {
    expect(checkDshFamilyVersion({ name: '@mutantcat/cordis', version: '4.0.1' }, '0.1.2-rc.1')).toBeUndefined()
    expect(checkDshFamilyVersion(
      { name: '@mutantcat/node-addon-system', version: '0.1.1' },
      '0.1.2-rc.1',
    )).toBeUndefined()
    expect(checkDshFamilyVersion({ version: '0.1.2-alpha.5' }, '0.1.2-rc.1')).toBeUndefined()
  })
})

describe('package payload constraints', () => {
  it('includes a declared profile patch without a package-name allowlist', () => {
    expect(expectedDshPackageFiles({
      name: '@mutantcat/dsh-private-profile',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })).toEqual([
      'lib/index.js',
      'cordis.patch.yml',
      'lib/types/**/*.d.ts',
    ])
  })

  it.each([
    'packages/client/ui-sidebar-documentpreview',
    'packages/client/ui-sidebar-terminal',
  ])('accepts package-local Client chunks from %s', (dir) => {
    const manifest = JSON.parse(readFileSync(new URL(`../${dir}/package.json`, import.meta.url), 'utf8')) as WorkspaceManifest['manifest']
    expect(checkWorkspaceManifest({ dir, manifest })).toEqual([])
  })
})

it('publishes CLI runtime declarations and rejects a payload that omits them', () => {
  const manifest = JSON.parse(readFileSync(new URL('../apps/cli/package.json', import.meta.url), 'utf8')) as WorkspaceManifest['manifest']
  expect(checkWorkspaceManifest({ dir: 'apps/cli', manifest })).toEqual([])
  expect(checkWorkspaceManifest({ dir: 'apps/cli', manifest: { ...manifest, files: ['lib/*.js'] } }))
    .toEqual([expect.stringContaining('@mutantcat/dsh: package.json files must be ["lib/*.js","lib/types/*.d.ts"]')])
})

it('requires the shared Web injection entry in the published payload', () => {
  const manifest = JSON.parse(readFileSync(new URL('../packages/client/web/package.json', import.meta.url), 'utf8')) as WorkspaceManifest['manifest']
  expect(checkWorkspaceManifest({ dir: 'packages/client/web', manifest })).toEqual([])
  expect(checkWorkspaceManifest({ dir: 'packages/client/web', manifest: {
    ...manifest, files: ['lib/index.js', 'lib/**/*.css', 'lib/types/**/*.d.ts'],
  } })).toEqual([expect.stringContaining('package.json files must be')])
})

it('requires Office skill bodies and helpers in the published payload', () => {
  const manifest = JSON.parse(readFileSync(new URL('../packages/skill/skill-office/package.json', import.meta.url), 'utf8')) as WorkspaceManifest['manifest']
  expect(checkWorkspaceManifest({ dir: 'packages/skill/skill-office', manifest })).toEqual([])
  expect(checkWorkspaceManifest({ dir: 'packages/skill/skill-office', manifest: {
    ...manifest, files: ['lib/index.js', 'lib/types/**/*.d.ts'],
  } })).toEqual([expect.stringContaining('package.json files must be')])
})
