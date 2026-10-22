/** React-free Client face of the explicit official-Harness chat-history import. */

import { Service, type Context } from '@mutantcat/cordis'
import type { RemoteFailure } from '@mutantcat/dsh-typert-protocol'
import type {} from '@mutantcat/dsh-api-session-controller/remote'
import type { SessionRemotes } from './sessions/remotes.ts'
import type { ISessions } from './contract/sessions.ts'
import type {
  SessionImportHarnessRequest,
  SessionImportHarnessValue,
} from '../types.ts'

declare module '@mutantcat/cordis' {
  interface Context {
    /** Client Harness chat-history import face and its Session-list refresh. */
    harnessSessionsImport: IHarnessSessionsImport
  }
}

/**
 * The Harness-import face injected into feature packages: the deployment's
 * configured source root plus one user-triggered import that publishes into
 * Alpha's own Session store.
 */
export interface IHarnessSessionsImport {
  /**
   * Read the deployment's configured default source sessions root.
   * @returns the configured foreign sessions root.
   */
  sourceRoot(): Promise<string>
  /**
   * Import every Session found under one source root, then refresh the Client
   * Session list so the adopted Sessions appear in navigation.
   * @param request - optional source-root override.
   * @returns the effective source root and one result per discovered Session.
   */
  importSessions(request: SessionImportHarnessRequest): Promise<SessionImportHarnessValue>
  /**
   * Export one local session as a Markdown transcript.
   * @param sessionId - Session to export.
   * @returns the Markdown transcript string.
   */
  exportSession(sessionId: string): Promise<string>
}

/** Owns the Client-side import call and the Session-list refresh it triggers. */
export class HarnessSessionsImport extends Service implements IHarnessSessionsImport {
  static inject = []

  /**
   * @param ctx - Client root Context that registers the import face.
   * @param remotes - mounted Session Remotes carrying the import verbs.
   * @param sessions - Client Session list, refreshed after an adopted import.
   */
  constructor(
    ctx: Context,
    private readonly remotes: SessionRemotes,
    private readonly sessions: ISessions,
  ) {
    super(ctx, 'harnessSessionsImport')
  }

  /** @inheritdoc */
  async sourceRoot(): Promise<string> {
    const result = await this.remotes.session.harnessSessionsRoot()
    if (!result.ok) throw commandError('source root read', result.error)
    return result.value.sourceRoot
  }

  /** @inheritdoc */
  async importSessions(
    request: SessionImportHarnessRequest,
  ): Promise<SessionImportHarnessValue> {
    const result = await this.remotes.session.importHarnessSessions(request)
    if (!result.ok) throw commandError('import', result.error)
    // The Host catalog changed outside this Client generation, so the
    // authoritative list must be re-pulled; there is no pushed increment.
    await this.sessions.refresh()
    return result.value
  }

  /** @inheritdoc */
  async exportSession(sessionId: string): Promise<string> {
    const result = await this.remotes.session.exportSessionMarkdown({ sessionId })
    if (!result.ok) throw commandError('export', result.error)
    return result.value.markdown
  }
}

/** Wrap one Remote failure in the error vocabulary command callers expect. */
function commandError(operation: string, failure: RemoteFailure): Error {
  return new Error(`harness session ${operation} failed: ${failure.code}: ${failure.message}`)
}
