/** Mount source modules through a real profile, patch file, and reload coordinator. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import yaml from 'js-yaml'
import type { Context } from '@mutantcat/cordis'
import { entryListSchema } from '@mutantcat/cordis-plugin-include'
import type { EntryOptions } from '@mutantcat/cordis-plugin-loader'
import Timer from '@mutantcat/cordis-plugin-timer'
import { initProfile, mountRootInclude, readProfilePatches, type ProfileContext } from '@mutantcat/dsh-app-boot'
import Hmr from '@mutantcat/dsh-hmr'
import ConfigEditor from '@mutantcat/dsh-config-editor'
import Settings from '../src/index.ts'

/** Attach the profile runtime to an initialized Loader with a source-module importer. */
export async function profileComposition(ctx: Context, home: string, baseFile: string): Promise<string> {
  const dir = join(home, 'profile')
  initProfile(dir, ['test-profile-bundle'])
  const bundle = join(dir, 'node_modules', 'test-profile-bundle')
  await mkdir(bundle, { recursive: true })
  await writeFile(join(home, 'package.json'), '{"name":"test-installation"}\n')
  await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'test-profile-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  const rows = yaml.load(await readFile(baseFile, 'utf8'), { schema: entryListSchema }) as EntryOptions[]
  for (const row of rows) row.id ??= row.name.replace('@mutantcat/dsh-', '')
  await writeFile(join(bundle, 'cordis.patch.yml'), yaml.dump([{ insert: rows }], { schema: entryListSchema }))
  await writeFile(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = {
    name: 'test', startedBundles: ['test-profile-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
  }
  ctx.provide('profileContext', profile)
  ctx.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
  await ctx.plugin(ConfigEditor)
  await ctx.plugin(Settings)
  await mountRootInclude(ctx, join(dir, 'cordis.yml'), readProfilePatches('test', profile))
  await ctx.loader.await()
  await ctx.plugin(Timer)
  await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
  await ctx.hmr.runExclusive(async () => {})
  return profile.patchPath
}
