/**
 * Client Harness-import face: one Remote read for the configured source root,
 * one import call, and the Session-list refresh the adopted Sessions need.
 */

import { Context } from '@mutantcat/cordis'
import { onTestFinished, describe, expect, it, vi } from 'vitest'
import type { SessionImportHarnessValue } from '../src/types.ts'
import { HarnessSessionsImport } from '../src/client/harness-import.ts'

const VALUE: SessionImportHarnessValue = {
  sourceRoot: '/foreign/sessions',
  results: [{ sourcePath: '/foreign/sessions/project/one', status: 'refused', reason: 'unknown format version 9' }],
}

/** Mount the Client face over one stubbed Remote and Session list. */
function harness(session: {
  harnessSessionsRoot: () => Promise<unknown>
  importHarnessSessions: (request: unknown) => Promise<unknown>
}) {
  const refresh = vi.fn(async () => undefined)
  const ctx = new Context()
  ctx.provide('remote', { session } as never)
  ctx.provide('sessions', { refresh } as never)
  onTestFinished(async () => { await ctx.fiber.dispose() })
  return { face: new HarnessSessionsImport(ctx), refresh }
}

describe('HarnessSessionsImport', () => {
  it('reads the configured source root through the Remote', async () => {
    const root = vi.fn(async () => ({ ok: true, value: { sourceRoot: '/foreign/sessions' } }))
    const { face } = harness({ harnessSessionsRoot: root, importHarnessSessions: async () => ({ ok: true, value: VALUE }) })

    await expect(face.sourceRoot()).resolves.toBe('/foreign/sessions')
    expect(root).toHaveBeenCalledTimes(1)
  })

  it('surfaces a failed source-root read with the Remote failure facts', async () => {
    const { face } = harness({
      harnessSessionsRoot: async () => ({ ok: false, error: { code: 'gateway/internal', message: 'setting unreadable' } }),
      importHarnessSessions: async () => ({ ok: true, value: VALUE }),
    })

    await expect(face.sourceRoot()).rejects
      .toThrow('harness session source root read failed: gateway/internal: setting unreadable')
  })

  it('imports through the Remote and refreshes the Session list afterwards', async () => {
    const order: string[] = []
    const { face, refresh } = harness({
      harnessSessionsRoot: async () => ({ ok: true, value: { sourceRoot: '/foreign/sessions' } }),
      importHarnessSessions: async (request) => {
        order.push(`import ${JSON.stringify(request)}`)
        return { ok: true, value: VALUE }
      },
    })
    refresh.mockImplementation(async () => { order.push('refresh') })

    await expect(face.importSessions({ sourceRoot: '/foreign/sessions' })).resolves.toEqual(VALUE)
    expect(order).toEqual(['import {"sourceRoot":"/foreign/sessions"}', 'refresh'])
  })

  it('leaves the Session list alone when the import fails', async () => {
    const { face, refresh } = harness({
      harnessSessionsRoot: async () => ({ ok: true, value: { sourceRoot: '/foreign/sessions' } }),
      importHarnessSessions: async () => ({ ok: false, error: { code: 'gateway/cancelled', message: 'request was aborted' } }),
    })

    await expect(face.importSessions({})).rejects
      .toThrow('harness session import failed: gateway/cancelled: request was aborted')
    expect(refresh).not.toHaveBeenCalled()
  })
})
