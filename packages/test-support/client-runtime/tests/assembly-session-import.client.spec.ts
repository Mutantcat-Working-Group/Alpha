// @vitest-environment jsdom
/**
 * The Harness-import face over the real composition: `@mutantcat/dsh-api-remotes`
 * stays in the roster so the Gateway mounts the `remote.session` namespace the
 * way the shipped app does. A consumer that injects only
 * `harnessSessionsImport` — like the session-management Settings page — must
 * reach the mounted namespace; the face is a plain class registered with
 * `ctx.reflect.provide`, because a Cordis `Service` would hand consumers a
 * traceable proxy that rebinds the face's `remotes` to the caller's context,
 * and the `remote.session` associate lookup then runs against a fiber that
 * never injected it.
 */
import { Context } from '@mutantcat/cordis'
import { describe, expect, it, onTestFinished } from 'vitest'
import { RemoteMock, ok } from '@mutantcat/dsh-remote-mock'
import { installConnection } from '@mutantcat/dsh-client-connection/client'
import { bootClient } from '@mutantcat/dsh-client-web/src/boot-client.ts'
import { remoteDefaultResponses, webApp } from '../src/assembly/index.ts'
import { graphFromRoster } from '../src/assembly/roster.ts'
import { createInProcessModules, loadPluginModules } from '../src/assembly/modules.ts'

const CONNECTION_PACKAGE = '@mutantcat/dsh-client-connection'
const IMPORT_SESSIONS_PACKAGE = '@mutantcat/dsh-client-ui-settings-import-sessions'

describe('session-management import face over the mounted namespaces', () => {
  it('answers source-root, source-list, import, and export reads from a consumer fiber', async () => {
    const mock = RemoteMock.create().load(remoteDefaultResponses)
      .unary('session/harnessSessionsRoot', ok({ sourceRoot: '/source/sessions' }))
      .unary('session/harnessSessionSources', ok({ sources: [{ agent: 'dsh', sourceRoot: '/source/sessions' }] }))
      .unary('session/importHarnessSessions', ok({ sourceRoot: '/source/sessions', results: [] }))
      .unary('session/exportSessionMarkdown', ok({ markdown: '# Transcript' }))
    const roster = webApp.closure([IMPORT_SESSIONS_PACKAGE])
    const ctx = new Context()
    const modules = new Map(await loadPluginModules({ roster }))
    const connection = modules.get(CONNECTION_PACKAGE)
    if (connection !== undefined) {
      modules.set(CONNECTION_PACKAGE, {
        ...connection,
        apply: (connectionCtx) => {
          installConnection(connectionCtx, { transport: { rpc: mock.rpc } })
        },
      })
    }
    const system = createInProcessModules(graphFromRoster(roster.rows), modules)
    await bootClient({ ctx, modules: system, manifest: system.manifest })
    onTestFinished(() => { void ctx.fiber.dispose() })

    interface PendingReads {
      sourceRoot: Promise<string>
      sources: Promise<unknown>
      imported: Promise<unknown>
      exported: Promise<string>
    }
    let pending: PendingReads | undefined
    await ctx.plugin({
      inject: ['harnessSessionsImport'],
      apply: (consumerCtx) => {
        pending = {
          sourceRoot: consumerCtx.harnessSessionsImport.sourceRoot(),
          sources: consumerCtx.harnessSessionsImport.sessionSources(),
          imported: consumerCtx.harnessSessionsImport.importSessions({ sourceRoot: '/source/sessions' }),
          exported: consumerCtx.harnessSessionsImport.exportSession('session-1'),
        }
      },
    })

    expect(pending).toBeDefined()
    await expect(pending!.sourceRoot).resolves.toBe('/source/sessions')
    await expect(pending!.sources).resolves.toEqual({ sources: [{ agent: 'dsh', sourceRoot: '/source/sessions' }] })
    await expect(pending!.imported).resolves.toEqual({ sourceRoot: '/source/sessions', results: [] })
    await expect(pending!.exported).resolves.toBe('# Transcript')
  })
})
