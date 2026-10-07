/** One document revision read, reporting the outcome the way every body settles it. */
import type { RemoteFailure, RemoteResult } from '@mutantcat/dsh-api-remotes/client'
import type { SessionFile } from '../rpc.ts'
import { hostFileOf } from '../rpc.ts'

/** One revision read a document body performs; the value names what the body settles. */
export type ReadDocumentRevision<T> = (file: SessionFile, signal: AbortSignal) => Promise<RemoteResult<T>>

/** A settled read failure as both body stores keep it for display. */
export interface RevisionReadFailure {
  readonly code: string
  readonly message: string
}

/** The body callbacks one revision read reports its outcome through. */
export interface RevisionReadReport<T> {
  /** @param value - the read value settled for this revision. */
  readonly complete: (value: T) => void
  /** @param failure - the failure the body's view settles with. */
  readonly failed: (failure: RevisionReadFailure) => void
  /** @param failure - declared file-read failure or exception message. @returns localized display text. */
  readonly describeFailure: (failure: RemoteFailure | { readonly message: string }) => string
}

/**
 * Read one document revision and report the settled outcome.
 *
 * A cancelled read reports nothing: the view that requested it is gone. A
 * rejected read settles the generic gateway failure carrying the carrier's
 * own message, because a Remote call rejects only where no declared failure
 * was produced.
 *
 * @param read - the body's revision read.
 * @param resourceAddress - the file address to read.
 * @param signal - this read's lifetime; an abort reports nothing.
 * @param report - the body callbacks the outcome reports through.
 * @returns settled once the outcome is reported or ignored.
 */
export async function readRevision<T>(
  read: ReadDocumentRevision<T>,
  resourceAddress: string,
  signal: AbortSignal,
  report: RevisionReadReport<T>,
): Promise<void> {
  try {
    const result = await read(hostFileOf(resourceAddress), signal)
    if (signal.aborted) return
    if (result.ok) report.complete(result.value)
    else report.failed({ code: result.error.code, message: report.describeFailure(result.error) })
  } catch (error: unknown) {
    if (signal.aborted) return
    report.failed({
      code: 'gateway/internal',
      message: report.describeFailure({ message: error instanceof Error ? error.message : String(error) }),
    })
  }
}
