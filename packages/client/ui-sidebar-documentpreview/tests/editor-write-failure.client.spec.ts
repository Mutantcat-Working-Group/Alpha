/** One sentence per write outcome, and the carrier's own words for anything else. */
import { describe, expect, it } from 'vitest'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// The namespace declaration `TranslateNS<'sidebarEditor'>` resolves against.
import type {} from '../src/client/index.ts'
import { writeFailureLine } from '../src/client/editor/write-failure.ts'

/** Key-echoing translate that also shows its parameters, so a formatted value is visible. */
const t: TranslateNS<'sidebarEditor'> = (key, params) =>
  params === undefined ? key : `${key}(${Object.entries(params).map(([k, v]) => `${k}=${String(v)}`).join(',')})`

function failure(code: string, details: Record<string, unknown> = {}, message = 'boom'): RemoteFailure {
  return { code, message, details } as unknown as RemoteFailure
}

describe('writeFailureLine', () => {
  it('names the stale guard and the sandbox denial', () => {
    expect(writeFailureLine(t, failure('workspace-file/stale-version'))).toBe('error.staleVersion')
    expect(writeFailureLine(t, failure('workspace-file/sandbox-denied'))).toBe('error.sandboxDenied')
  })

  it('passes any other write failure through in its own words', () => {
    expect(writeFailureLine(t, failure('workspace-file/write-failed', {}, 'disk full'))).toBe('error.writeFailed(message=disk full)')
    expect(writeFailureLine(t, failure('gateway/internal', {}, 'socket closed'))).toBe('error.writeFailed(message=socket closed)')
  })
})
