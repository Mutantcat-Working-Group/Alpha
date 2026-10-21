/**
 * Explicit import of the official DeepSeek Harness chat history into Alpha's
 * own Session store.
 *
 * The operation is read-only over its source root, idempotent, and isolated
 * per Session: it discovers the authoritative generation of every Session
 * under the source root, restores each one through the build-static format
 * catalog (so an older generation is migrated, never rewritten), validates the
 * restored log against the storage contract, and only then copies it into
 * Alpha's store through the mounted persistence backend. Nothing here watches,
 * polls, or synchronizes; one user-triggered call imports what exists now.
 * @module @mutantcat/dsh-api-session-controller/import-harness-sessions
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Context } from '@mutantcat/cordis'
import { expandHomePath } from '@mutantcat/dsh-home-paths'
import type { SessionEvent, SessionHeader, SessionId, SessionLogOffset } from '@mutantcat/dsh-session'
import type { SessionPersistence } from '@mutantcat/dsh-session-persistence'
import {
  listForeignSessionGenerations,
  readForeignSessionContent,
  readForeignSessionHeader,
  type ForeignSessionGeneration,
  type ForeignSessionHeader,
} from '@mutantcat/dsh-session-persistence-jsonl/foreign'
import { RemoteError } from '@mutantcat/dsh-typert-protocol'
import type {
  SessionImportHarnessRequest,
  SessionImportHarnessResult,
  SessionImportHarnessValue,
} from './types.ts'

/** Official DeepSeek Harness home directory name; Alpha's own home is `.alpha`. */
const HARNESS_HOME_DIR_NAME = '.dsh'

/**
 * Default source sessions root: the official DeepSeek Harness home's
 * `sessions` directory. Adoption-varying choice, so the plugin exposes it as a
 * validated `Config` field rather than a fixed constant.
 * @returns the absolute default foreign sessions root.
 */
export function defaultHarnessSessionsRoot(): string {
  return join(homedir(), HARNESS_HOME_DIR_NAME, 'sessions')
}

/**
 * Normalize the deployment-configured source root: expand a supported tilde
 * prefix and resolve it against the working directory. A blank value uses
 * {@link defaultHarnessSessionsRoot}, so a blank config never resolves to the
 * working directory.
 * @param configured - configured `harnessSessionsRoot`, if any.
 * @returns the absolute configured source root.
 */
export function configuredHarnessSessionsRoot(configured?: string): string {
  const selected = configured?.trim()
  return resolve(expandHomePath(
    selected === undefined || selected === '' ? defaultHarnessSessionsRoot() : selected,
  ))
}

/** One scan outcome: the Sessions whose headers were read, plus their refusals. */
interface HarnessScan {
  readonly headers: readonly ForeignSessionHeader[]
  readonly results: readonly SessionImportHarnessResult[]
}

/**
 * Owns the official-Harness chat-history import against Alpha's Session store.
 *
 * Steps, in order: **scan** the foreign root for one generation per Session and
 * restore each header; **validate** each restored log with the storage
 * contract; **migrate** an older generation through the format catalog; and
 * **copy** the validated current-format log into Alpha's store through
 * `ctx.sessionPersistence`, which owns Alpha's own root and physical encoding.
 */
export class HarnessSessionImport {
  /**
   * @param ctx - Host context carrying the persistence backend Alpha stores through.
   * @param configuredSourceRoot - deployment-configured default foreign sessions root.
   */
  constructor(
    private readonly ctx: Context,
    private readonly configuredSourceRoot: string,
  ) {}

  /** Configured default foreign sessions root, without any per-request override. */
  get sourceRoot(): string {
    return this.configuredSourceRoot
  }

  /**
   * Resolve the root one request addresses, applying the configured default
   * explicitly. The operation never defaults internally, and a blank override
   * is treated as an omission rather than as the current directory.
   * @param request - import request whose optional root overrides the configuration.
   * @returns the absolute, tilde-expanded source sessions root.
   */
  resolve(request: SessionImportHarnessRequest): string {
    const requested = request.sourceRoot?.trim()
    if (requested === undefined || requested === '') return this.configuredSourceRoot
    return resolve(expandHomePath(requested))
  }

  /**
   * Import every Session discovered under the resolved source root.
   * @param request - optional source-root override.
   * @param signal - caller cancellation for reads, migration, and publication.
   * @returns the effective source root and one result per discovered Session.
   * @throws {RemoteError} when the deployment mounts no persistence backend.
   */
  async run(
    request: SessionImportHarnessRequest,
    signal: AbortSignal,
  ): Promise<SessionImportHarnessValue> {
    const sourceRoot = this.resolve(request)
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) {
      throw new RemoteError(
        'gateway/internal',
        'the Harness chat-history import needs a mounted session-persistence backend to store what it adopts',
        {},
      )
    }
    const scan = await this.scan(sourceRoot, signal)
    const results: SessionImportHarnessResult[] = [...scan.results]
    for (const header of scan.headers) {
      signal.throwIfAborted()
      results.push(await this.adopt(persistence, header, scan.headers, signal))
    }
    return { sourceRoot, results }
  }

  /**
   * Discover the authoritative generation of every Session under one foreign
   * root and restore each header through the format catalog. A Session whose
   * header cannot be restored is refused on its own; its siblings still scan.
   * @param sourceRoot - foreign sessions root, never written.
   * @param signal - caller cancellation for directory and header reads.
   * @returns restorable headers plus one refusal per unreadable generation.
   */
  private async scan(sourceRoot: string, signal: AbortSignal): Promise<HarnessScan> {
    const generations = await listForeignSessionGenerations(sourceRoot, signal)
    const headers: ForeignSessionHeader[] = []
    const results: SessionImportHarnessResult[] = []
    for (const generation of generations) {
      signal.throwIfAborted()
      try {
        headers.push(await readForeignSessionHeader(generation, signal))
      } catch (error: unknown) {
        results.push(refused(generation, error))
      }
    }
    return { headers, results }
  }

  /**
   * Migrate, validate, and copy one scanned Session into Alpha's store.
   *
   * Migration runs through the build-static catalog chain, so an older source
   * generation is published in the installed current format without touching
   * the source. Validation runs the storage contract before any write, so a
   * corrupt source never reaches Alpha's data. A Session already present in
   * Alpha is reported and left untouched, which makes a repeated run a no-op.
   * @param persistence - Alpha's mounted persistence backend.
   * @param header - scanned Session header, already restored to the current format.
   * @param corpus - every scanned header, supplying child evidence to a V3 migration.
   * @param signal - caller cancellation for reads and publication.
   * @returns this Session's outcome; a failure is reported, never thrown.
   */
  private async adopt(
    persistence: SessionPersistence,
    header: ForeignSessionHeader,
    corpus: readonly ForeignSessionHeader[],
    signal: AbortSignal,
  ): Promise<SessionImportHarnessResult> {
    const generation = header.generation
    try {
      if (await persistence.stat(header.header.id, { signal }) !== undefined) {
        return { sourcePath: generation.path, sessionId: header.header.id, status: 'already-present' }
      }
      const content = await readForeignSessionContent(header, corpus, signal)
      const events = [...content.events]
      await validateStoredLog(content.header, events, generation)
      await this.publish(persistence, content.header, events, content.inheritedEventCount, signal)
      return { sourcePath: generation.path, sessionId: content.header.id, status: 'imported' }
    } catch (error: unknown) {
      if (isAlreadyPresent(error)) {
        return { sourcePath: generation.path, sessionId: header.header.id, status: 'already-present' }
      }
      signal.throwIfAborted()
      return refused(generation, error, header.header.id)
    }
  }

  /**
   * Copy one validated current-format log into Alpha's store through the
   * mounted backend, which owns the store's root and physical encoding.
   * @param persistence - Alpha's mounted persistence backend.
   * @param header - validated current-format Session header.
   * @param events - validated contiguous current-format events.
   * @param inheritedEventCount - exact fork-inherited prefix length.
   * @param signal - caller cancellation, observed only before the write starts.
   */
  private async publish(
    persistence: SessionPersistence,
    header: SessionHeader,
    events: SessionEvent[],
    inheritedEventCount: SessionLogOffset,
    signal: AbortSignal,
  ): Promise<void> {
    // One adopted Session is one commit: cancellation is refused here rather
    // than inside the create/append/flush sequence, because a write torn by a
    // caller abort would leave a partial log under the source id, and the next
    // run reports that id as already present instead of finishing the copy.
    signal.throwIfAborted()
    const handle = await persistence.create(header, { inheritedEventCount })
    try {
      await handle.append(events)
      await handle.flush()
    } finally {
      await handle.close()
    }
  }
}

/** Whether a failed create means another writer published the same Session first. */
function isAlreadyPresent(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'SessionAlreadyExistsError'
}

/**
 * Check one restored log against the storage contract before anything is
 * written. The contract package is optional in compositions that mount no
 * persistence backend, so it loads here, after a mounted backend is known.
 * @param header - restored current-format header.
 * @param events - restored contiguous events.
 * @param generation - source generation named in a refusal.
 */
async function validateStoredLog(
  header: SessionHeader,
  events: readonly SessionEvent[],
  generation: ForeignSessionGeneration,
): Promise<void> {
  const { assertContiguous, assertVersion, validateStoredEvents } = await import('@mutantcat/dsh-session-persistence')
  const where = { kind: 'jsonl', path: generation.path } as const
  const stored = [...events]
  assertVersion(header, where)
  validateStoredEvents(header, stored, where)
  assertContiguous(header.id, stored, 0)
}

/** Build one refusal result without exposing a hostile non-Error rejection. */
function refused(
  generation: ForeignSessionGeneration,
  error: unknown,
  sessionId?: SessionId,
): SessionImportHarnessResult {
  const reason = error instanceof Error ? error.message : String(error)
  return {
    sourcePath: generation.path,
    ...sessionId === undefined ? {} : { sessionId },
    status: 'refused',
    reason,
  }
}
