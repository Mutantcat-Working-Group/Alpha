/** Collect historical discovery facts without recursively preparing related current generations. */

import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { historicalSessionFormatCatalog, sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { historicalChildCatalogSource } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { SessionFormatUnsupportedError, SessionPersistenceCorruptionError } from '@deepseek-ai/dsh-session-persistence'
import { SessionFormatError, SessionFormatUnsupportedMigrationError } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { parseGenerationLogFilename } from './format.ts'
import type { JsonlCompression } from './format.ts'
import { JsonlGenerationSourceChangedError, readDecodedJsonlSource } from './generation.ts'
import type { JsonlPhysicalIdentity } from './generation.ts'

/** Per-parent supplemental facts and the source checks required before serving or publishing them. */
interface PreparedCatalogFacts {
  readonly facts: readonly SessionFormatJsonObject[]
  /** @returns resolves while every decoded child still has the captured physical revision. */
  validate(): Promise<void>
}

/**
 * Collect each related child's own descriptor through existing historical codecs.
 * @param parentId - parent whose incoming migration consumes these facts.
 * @param sources - header-indexed direct children in the selected source corpus.
 * @param compression - configured source encoding.
 * @param signal - cancellation forwarded through each source read.
 * @returns compact facts; complete child event arrays are released after extraction.
 */
export async function prepareCatalogFacts(
  parentId: SessionId,
  sources: readonly { readonly header: SessionHeader; readonly path: string }[],
  compression: JsonlCompression,
  signal: AbortSignal,
): Promise<PreparedCatalogFacts> {
  const facts: SessionFormatJsonObject[] = []
  const witnesses: { path: string; identity: JsonlPhysicalIdentity }[] = []
  for (const source of sources) {
    signal.throwIfAborted()
    const version = parseGenerationLogFilename(basename(source.path), compression)
    if (version === undefined) throw new SessionFormatUnsupportedMigrationError(`unrecognized historical child generation ${source.path}`)
    let restored: Awaited<ReturnType<typeof readDecodedJsonlSource>>
    try {
      restored = await readDecodedJsonlSource(source.path, version, compression, {
        createRestore: header => (version <= 3 ? historicalSessionFormatCatalog : sessionFormatCatalog).createRestore(header, {
          recovery: 'recoverable', validation: 'current',
        }),
      }, signal)
    } catch (error: unknown) {
      if (error instanceof SessionFormatUnsupportedMigrationError) {
        throw new SessionFormatUnsupportedError(
          `child Session ${source.header.id}: ${error.message} (raw log: ${source.path})`,
          { kind: 'jsonl', path: source.path },
        )
      }
      if (error instanceof SessionFormatError) {
        throw new SessionPersistenceCorruptionError(`child Session ${source.header.id}: ${error.message} (raw log: ${source.path})`, { cause: error })
      }
      throw error
    }
    const header = restored.artifact.header
    if (header.id !== source.header.id || header.createdAt !== source.header.createdAt
      || header.parentSession !== parentId || header.origin !== 'subagent'
      || ['cwd', 'isSeeded', 'delegationDepth', 'agentPreset'].some(key => header[key] !== source.header[key as keyof SessionHeader])) {
      throw new JsonlGenerationSourceChangedError(source.path)
    }
    facts.push({ ...historicalChildCatalogSource(restored.artifact), sourcePath: source.path })
    witnesses.push({ path: source.path, identity: restored.identity })
  }
  return {
    facts,
    async validate() {
      for (const witness of witnesses) {
        const current = await stat(witness.path, { bigint: true })
        if (current.dev !== witness.identity.dev || current.ino !== witness.identity.ino
          || current.size !== witness.identity.size || current.mtimeNs !== witness.identity.mtimeNs
          || current.ctimeNs !== witness.identity.ctimeNs) throw new JsonlGenerationSourceChangedError(witness.path)
      }
    },
  }
}
