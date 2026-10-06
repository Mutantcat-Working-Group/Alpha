/**
 * The bundle's substance is its patch file: the `dsh.bundle.patch` manifest
 * field must name a real, parseable patch list.
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@mutantcat/cordis-plugin-include'
import { evaluate } from '@mutantcat/cordis-plugin-loader'

describe('dsh-base bundle', () => {
  it('declares a parseable patch list through the dsh.bundle.patch manifest field', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    )
    expect(Array.isArray(parsed)).toBe(true)
    // The base layer is one insert list over the empty profile root.
    const rows = (parsed as { insert?: { id?: string; config?: Record<string, unknown>; disabled?: boolean }[] }[]).flatMap(
      patch => patch.insert ?? [],
    )
    expect(rows.length).toBeGreaterThan(50)
    expect(rows.some(row => row.id === 'agent-loop')).toBe(true)
    // Alpha ships no online paths of its own: no telemetry collector row, no
    // search route, and no request-field contributor aimed at a vendor
    // endpoint. Every row that would leave the process with session data or a
    // request is a deployment's own overlay, never part of this layer.
    for (const id of [
      'session-telemetry-otel',
      'web-search-deepseek',
      'llm-deepseek',
      'deepseek-llm-api-extensions',
      'session-log-deepseek',
      'plugin-package-inventory-deepseek',
    ]) {
      expect(rows.find(row => row.id === id), `row ${id} must not ship`).toBeUndefined()
    }
    // The default-model row mounts with no preset: a deployment that wants a
    // preselected provider states it in a later layer.
    expect(rows.find(row => row.id === 'agent-default-model')).toMatchObject({
      name: '@mutantcat/dsh-agent-default-model',
      config: undefined,
    })
    expect(rows.find(row => row.id === 'hmr')).toMatchObject({
      config: { root: [] },
    })
    expect(rows.filter(row => row.id === 'subagent-codex')).toHaveLength(0)
    expect(rows.filter(row => row.id === 'subagent-claude-code')).toHaveLength(0)
    expect(rows.find(row => row.id === 'web')?.config).toMatchObject({ fetchProvider: 'http' })
    expect(rows.find(row => row.id === 'web-fetch-http')).toBeDefined()
    expect(rows.find(row => row.id === 'tool-web')?.config).toMatchObject({ search: false, fetch: true })
    expect(manifest.dependencies).not.toHaveProperty('@mutantcat/dsh-subagent-codex')
    expect(manifest.dependencies).not.toHaveProperty('@mutantcat/dsh-subagent-claude-code')
    for (const dependency of [
      '@mutantcat/dsh-session-telemetry-otel',
      '@mutantcat/dsh-web-search-deepseek',
      '@mutantcat/dsh-llm-deepseek',
      '@mutantcat/dsh-deepseek-llm-api-extensions',
      '@mutantcat/dsh-session-log-deepseek',
      '@mutantcat/dsh-plugin-package-inventory-deepseek',
    ]) {
      expect(manifest.dependencies, `dependency ${dependency} must not ship`).not.toHaveProperty(dependency)
    }
    expect(manifest.dependencies).toHaveProperty('@mutantcat/dsh-web-fetch-http')
  })

  it('gates each shell stack by platform with a symmetric disabled expression', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const parsed = yaml.load(
      readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'),
      { schema: entryListSchema },
    )
    if (!Array.isArray(parsed)) throw new TypeError('base patch must parse to a patch list')
    const rows = parsed.flatMap((patch): Record<string, unknown>[] =>
      typeof patch === 'object' && patch !== null
        ? (patch as { insert?: Record<string, unknown>[] }).insert ?? []
        : [],
    )
    // Symmetric gating: each stack's executor and tool rows carry the same
    // platform fact, inverted between the bash and pwsh twins, so exactly one
    // shell stack mounts per host. Evaluate with a platform-scoped context
    // (the `with` scope shadows the global `process`) so both outcomes pin on
    // every host.
    for (const [id, win32, linux] of [
      ['bash-sandbox', true, false],
      ['tool-bash', true, false],
      ['pwsh-sandbox', false, true],
      ['tool-pwsh', false, true],
    ] as const) {
      const row = rows.find(candidate => candidate.id === id)
      if (row === undefined) throw new Error(`base patch must mount ${id}`)
      const expression = (row.disabled as { __jsExpr?: string } | undefined)?.__jsExpr
      if (expression === undefined) throw new Error(`${id} must gate on a !!js disabled expression`)
      expect(Boolean(evaluate({ process: { platform: 'win32' } }, expression)), `${id} on win32`).toBe(win32)
      expect(Boolean(evaluate({ process: { platform: 'linux' } }, expression)), `${id} on linux`).toBe(linux)
    }
    // The platform layer folded into these rows: no separate patch file ships.
    expect(existsSync(resolve(root, 'windows.cordis.patch.yml'))).toBe(false)
  })
})
