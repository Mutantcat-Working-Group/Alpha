/**
 * Client Harness-import face: one Remote read for the configured source root,
 * one Remote discovery of the installed Agent sources, one import call, and
 * the Session-list refresh the adopted Sessions need.
 */

import { describe, expect, it, vi } from 'vitest'
import type { SessionImportHarnessValue } from '../src/types.ts'
import { HarnessSessionsImport } from '../src/client/harness-import.ts'

const VALUE: SessionImportHarnessValue = {
  sourceRoot: '/foreign/sessions',
  results: [{ sourcePath: '/foreign/sessions/project/one', status: 'refused', reason: 'unknown format version 9' }],
}

/** Mount the Client face over one stubbed Remote and Session list. */
function harness(session: {
  harnessSessionsRoot: () => Promise<unknown>
  harnessSessionSources: () => Promise<unknown>
  importHarnessSessions: (request: unknown) => Promise<unknown>
}) {
  const refresh = vi.fn(async () => undefined)
  const remotes = { session } as never
  const sessions = { refresh } as never
  return { face: new HarnessSessionsImport(remotes, sessions), refresh }
}

describe('HarnessSessionsImport', () => {
  it('reads the configured source root through the Remote', async () => {
    const root = vi.fn(async () => ({ ok: true, value: { sourceRoot: '/foreign/sessions' } }))
    const { face } = harness({
      harnessSessionsRoot: root,
      harnessSessionSources: async () => ({ ok: true, value: { sources: [] } }),
      importHarnessSessions: async () => ({ ok: true, value: VALUE }),
    })

    await expect(face.sourceRoot()).resolves.toBe('/foreign/sessions')
    expect(root).toHaveBeenCalledTimes(1)
  })

  it('lists the installed Agent sources through the Remote', async () => {
    const sources = vi.fn(async () => ({
      ok: true,
      value: {
        sources: [
          { agent: 'dsh', sourceRoot: '/foreign/sessions' },
          { agent: 'codex', sourceRoot: '/home/.codex' },
        ],
      },
    }))
    const { face } = harness({
      harnessSessionsRoot: async () => ({ ok: true, value: { sourceRoot: '/foreign/sessions' } }),
      harnessSessionSources: sources,
      importHarnessSessions: async () => ({ ok: true, value: VALUE }),
    })

    await expect(face.sessionSources()).resolves.toEqual({
      sources: [
        { agent: 'dsh', sourceRoot: '/foreign/sessions' },
        { agent: 'codex', sourceRoot: '/home/.codex' },
      ],
    })
    expect(sources).toHaveBeenCalledTimes(1)
  })

  it('surfaces a failed source discovery with the Remote failure facts', async () => {
    const { face } = harness({
      harnessSessionsRoot: async () => ({ ok: true, value: { sourceRoot: '/foreign/sessions' } }),
      harnessSessionSources: async () => ({ ok: false, error: { code: 'gateway/internal', message: 'home unreadable' } }),
      importHarnessSessions: async () => ({ ok: true, value: VALUE }),
    })

    await expect(face.sessionSources()).rejects
      .toThrow('harness session session source discovery failed: gateway/internal: home unreadable')
  })

  it('surfaces a failed source-root read with the Remote failure facts', async () => {
    const { face } = harness({
      harnessSessionsRoot: async () => ({ ok: false, error: { code: 'gateway/internal', message: 'setting unreadable' } }),
      harnessSessionSources: async () => ({ ok: true, value: { sources: [] } }),
      importHarnessSessions: async () => ({ ok: true, value: VALUE }),
    })

    await expect(face.sourceRoot()).rejects
      .toThrow('harness session source root read failed: gateway/internal: setting unreadable')
  })

  it('imports through the Remote and refreshes the Session list afterwards', async () => {
    const order: string[] = []
    const { face, refresh } = harness({
      harnessSessionsRoot: async () => ({ ok: true, value: { sourceRoot: '/foreign/sessions' } }),
      harnessSessionSources: async () => ({ ok: true, value: { sources: [] } }),
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
      harnessSessionSources: async () => ({ ok: true, value: { sources: [] } }),
      importHarnessSessions: async () => ({ ok: false, error: { code: 'gateway/cancelled', message: 'request was aborted' } }),
    })

    await expect(face.importSessions({})).rejects
      .toThrow('harness session import failed: gateway/cancelled: request was aborted')
    expect(refresh).not.toHaveBeenCalled()
  })
})
