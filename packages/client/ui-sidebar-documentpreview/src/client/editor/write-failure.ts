/**
 * The failure line one guarded write deserves.
 *
 * Kept apart from the component so the mapping is testable on its own. The
 * stale guard names a file the reader has to look at again; the other codes
 * fall to the generic line carrying the carrier's message.
 */
import type { RemoteFailure } from '@mutantcat/dsh-api-remotes/client'
import type { TranslateNS } from '@mutantcat/dsh-client-locale/client'

/**
 * Say why the save did not land, in terms of the file rather than of the transport.
 * @param t - namespace-bound translate.
 * @param failure - the settled Remote failure.
 * @returns the line to show above the editor.
 */
export function writeFailureLine(t: TranslateNS<'sidebarEditor'>, failure: RemoteFailure): string {
  switch (failure.code) {
    case 'workspace-file/stale-version': return t('error.staleVersion')
    case 'workspace-file/sandbox-denied': return t('error.sandboxDenied')
    default: return t('error.writeFailed', { message: failure.message })
  }
}
