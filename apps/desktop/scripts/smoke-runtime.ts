/** Boot the materialized target runtime without access to a user's Harness profile. */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DesktopHostProcess } from '../src/host-process.ts'
import { createPluginProfile } from '../src/project-manager.ts'
import type { DesktopRuntimeDescriptor } from '../src/runtime-tree.ts'

/**
 * Prove the final resource tree boots and serves its matching Web frontend.
 * @param root - Materialized dsh resources.
 * @param node - Prepared target Node executable.
 * @param runtime - Verified resource descriptor.
 */
export async function smokeDesktopRuntime(root: string, node: string, runtime: DesktopRuntimeDescriptor): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-smoke-'))
  const profile = join(home, 'profiles', 'desktop')
  const host = new DesktopHostProcess(node, root, profile, undefined, { ...process.env, DSH_HOME: home })
  try {
    createPluginProfile(profile)
    const pluginName = 'desktop-runtime-smoke-plugin'
    const plugin = join(profile, 'node_modules', pluginName)
    mkdirSync(plugin, { recursive: true })
    const cordis = runtime.sharedPackages.find(entry => entry.name === '@mutantcat/cordis')
    if (cordis === undefined) throw new Error('desktop runtime: missing shared Cordis package')
    writeFileSync(join(plugin, 'package.json'), JSON.stringify({
      name: pluginName, version: '1.0.0', type: 'module', exports: './index.js',
      peerDependencies: { '@mutantcat/cordis': cordis.version }, dsh: { bundle: { patch: './bundle.yml' } },
    }))
    writeFileSync(join(plugin, 'index.js'), `
import { Context } from '@mutantcat/cordis'
export function apply(ctx) {
  if (!(ctx instanceof Context)) throw new Error('desktop runtime: external plugin loaded another Cordis instance')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/desktop-smoke',
    handler(_request, response) { response.end('plugin route ready') } }))
}
`)
    writeFileSync(join(plugin, 'bundle.yml'), '- insert:\n    - id: desktop-runtime-smoke-plugin\n      name: desktop-runtime-smoke-plugin\n      inject: [webServer]\n')
    const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    manifest.dependencies[pluginName] = '1.0.0'
    manifest.dsh.profile.bundles.push(pluginName)
    writeFileSync(join(profile, 'package.json'), JSON.stringify(manifest))
    writeFileSync(join(profile, 'cordis.patch.yml'), '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 0\n')
    const ready = await host.start()
    const login = await fetch(ready.url, { redirect: 'manual' })
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    const response = await fetch(new URL('/', ready.url), { headers: { cookie } })
    const index = await response.text()
    if (response.status !== 200 || !index.includes('<html')) {
      throw new Error('desktop runtime: packaged frontend smoke failed')
    }
    // A page that answers <html> can still ship a broken client boot graph, so
    // read the injected graph and prove EVERY advertised client bundle is
    // served. Fetching stages one batch is not enough: one missing package
    // bundle is the "N entries did not activate" failure users hit.
    if (!index.includes('window.__ModuleLoader__')) {
      throw new Error('desktop runtime: packaged frontend boot graph is missing from the served document')
    }
    const bootMatch = /globalThis\["__DSH_BOOT__"\] = (.*?)<\/script>/u.exec(index)
    if (bootMatch === null) {
      throw new Error('desktop runtime: packaged frontend serves no __DSH_BOOT__ graph')
    }
    const graph = JSON.parse(bootMatch[1] as string) as {
      batches?: { url?: unknown; entries?: unknown }[]
      entries?: { id?: unknown; url?: unknown }[]
    }
    if (!Array.isArray(graph.batches) || !Array.isArray(graph.entries) || graph.entries.length === 0) {
      throw new Error('desktop runtime: packaged frontend boot graph carries no client entries')
    }
    const bundleUrls = new Set<string>()
    for (const batch of graph.batches) {
      if (typeof batch.url !== 'string' || !Array.isArray(batch.entries) || batch.entries.length === 0) {
        throw new Error('desktop runtime: packaged frontend boot batch is malformed')
      }
      bundleUrls.add(batch.url)
    }
    for (const entry of graph.entries) {
      if (typeof entry.id !== 'string' || typeof entry.url !== 'string') {
        throw new Error('desktop runtime: packaged frontend boot entry is malformed')
      }
      bundleUrls.add(entry.url)
    }
    for (const bundleUrl of bundleUrls) {
      const bundle = await fetch(new URL(bundleUrl, ready.url), { headers: { cookie } })
      if (!bundle.ok || bundle.headers.get('content-type') !== 'text/javascript; charset=utf-8') {
        throw new Error(
          `desktop runtime: packaged client bundle ${bundleUrl} is not served as JavaScript `
          + `(${String(bundle.status)} ${bundle.headers.get('content-type') ?? 'no content-type'})`,
        )
      }
    }
    const pluginResponse = await fetch(new URL('/desktop-smoke', ready.url), { headers: { cookie } })
    if (await pluginResponse.text() !== 'plugin route ready') throw new Error('desktop runtime: plugin HTTP route failed')
  } finally {
    await host.stop()
    rmSync(home, { recursive: true, force: true })
  }
}
