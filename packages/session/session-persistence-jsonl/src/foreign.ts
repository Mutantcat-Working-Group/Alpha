/**
 * Read-only access to a foreign sessions root laid out like this backend's own
 * (`<root>/<project>/<session>/session[.vN].jsonl[.zstd]`). Discovery and
 * decoding reuse this backend's physical framing and the build-static format
 * catalog, so a caller can adopt another Harness installation's sessions
 * without duplicating either. Nothing in this module writes to the foreign
 * root; publishing a successor into Alpha's own store belongs to the caller.
 * @module @mutantcat/dsh-session-persistence-jsonl/foreign
 */

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createSessionFormatCatalogWithChildren,
  sessionFormatCatalog,
} from '@mutantcat/dsh-session-format-catalog'
import { SessionId, SessionLogOffset } from '@mutantcat/dsh-session'
import type {
  SessionEvent,
  SessionHeader,
  SessionLogOffset as SessionLogOffsetType,
} from '@mutantcat/dsh-session'
import { prepareCatalogFacts } from './catalog-migration.ts'
import {
  assertNoRetiredHeaderFields,
  generationLogPath,
  parseGenerationLogFilename,
  type JsonlCompression,
} from './format.ts'
import { readDecodedJsonlSource, readStableJsonlFile } from './generation.ts'
import { createZstdFrameDecoder, scanZstdFrames } from './zstd.ts'

/** One authoritative generation discovered under a foreign sessions root. */
export interface ForeignSessionGeneration {
  /** Sessions root this generation was discovered under. */
  readonly root: string
  /** Absolute path of the generation artifact. */
  readonly path: string
  /** Generation version parsed from the canonical filename. */
  readonly version: number
  /** Physical encoding parsed from the filename suffix. */
  readonly compression: JsonlCompression
}

/** One foreign generation with its header restored to the installed format. */
export interface ForeignSessionHeader {
  readonly generation: ForeignSessionGeneration
  /** Current logical header restored through the built-in migration chain. */
  readonly header: SessionHeader
  /** The physical header record, retained for the later content read. */
  readonly record: Record<string, unknown>
}

/** Complete current-format logical content of one foreign generation. */
export interface ForeignSessionContent {
  readonly generation: ForeignSessionGeneration
  readonly header: SessionHeader
  readonly events: readonly SessionEvent[]
  /** Exact fork-inherited prefix length restored from the source artifact. */
  readonly inheritedEventCount: SessionLogOffsetType
}

function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/**
 * List the authoritative generation of every Session under a foreign sessions
 * root. Each Session directory contributes its numerically highest canonical
 * generation; a directory declaring the same version in both physical
 * encodings resolves to the Zstandard artifact.
 * @param root - foreign sessions root, read but never written.
 * @param signal - optional cancellation for directory reads.
 * @returns one generation per Session directory, in discovery order.
 * @throws when the root or one of its project directories is unreadable for a
 *   reason other than absence.
 */
export async function listForeignSessionGenerations(
  root: string,
  signal?: AbortSignal,
): Promise<readonly ForeignSessionGeneration[]> {
  const generations: ForeignSessionGeneration[] = []
  signal?.throwIfAborted()
  let projects
  try {
    projects = await readdir(root, { withFileTypes: true })
  } catch (error: unknown) {
    // An absent root owns no sessions; every other read failure must surface.
    if (isENOENT(error)) return generations
    throw error
  }
  for (const project of projects) {
    signal?.throwIfAborted()
    if (!project.isDirectory()) continue
    const sessions = await readdir(join(root, project.name), { withFileTypes: true })
    for (const session of sessions) {
      signal?.throwIfAborted()
      if (!session.isDirectory()) continue
      const selected = await selectGeneration(root, join(root, project.name, session.name))
      if (selected !== undefined) generations.push(selected)
    }
  }
  return generations
}

/** Select one Session directory's highest canonical generation. */
async function selectGeneration(
  root: string,
  directory: string,
): Promise<ForeignSessionGeneration | undefined> {
  const candidates: ForeignSessionGeneration[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    for (const compression of ['zstd', 'none'] as const) {
      const version = parseGenerationLogFilename(entry.name, compression)
      if (version === undefined) continue
      candidates.push({ root, path: join(directory, entry.name), version, compression })
    }
  }
  const highest = candidates.reduce<number | undefined>(
    (best, candidate) => best === undefined || candidate.version > best ? candidate.version : best,
    undefined,
  )
  if (highest === undefined) return undefined
  const atHighest = candidates.filter(candidate => candidate.version === highest)
  return atHighest.find(candidate => candidate.compression === 'zstd') ?? atHighest[0]
}

/**
 * Restore one foreign generation's header to the installed current format
 * without reading its event rows, and refuse a header that does not identify
 * the generation's own path.
 * @param generation - generation selected by {@link listForeignSessionGenerations}.
 * @param signal - optional cancellation for the source read.
 * @returns the migrated logical header plus the physical record.
 * @throws {SessionFormatUnsupportedError} for a newer or malformed format.
 */
export async function readForeignSessionHeader(
  generation: ForeignSessionGeneration,
  signal?: AbortSignal,
): Promise<ForeignSessionHeader> {
  const { bytes } = await readStableJsonlFile(generation.path, signal)
  const record = parseHeaderRecord(bytes, generation.compression)
  assertNoRetiredHeaderFields(record)
  const result = sessionFormatCatalog.readHeader(record)
  if (result.status === 'unsupported' || result.status === 'malformed') {
    throw new Error(`session header at "${generation.path}" cannot be read: ${result.reason}`)
  }
  const header = toStoredHeader(result.header)
  const expected = generationLogPath(
    generation.root,
    header.cwd,
    header.id,
    generation.version,
    generation.compression,
  )
  if (generation.path !== expected) {
    throw new Error(
      `session header at "${generation.path}" identifies "${expected}"; refusing a generation that does not own its path`,
    )
  }
  return { generation, header, record }
}

/**
 * Decode one foreign generation into complete current-format logical content
 * through the built-in migration chain. Child evidence for a V3 parent is
 * drawn from the scanned corpus, so a subagent child's catalog participation
 * survives the import.
 * @param parent - header already restored by {@link readForeignSessionHeader}.
 * @param corpus - every scanned generation, used only to collect this parent's children.
 * @param signal - optional cancellation for source reads and decode yields.
 * @returns the migrated header, its contiguous events, and the inherited cut.
 * @throws {SessionFormatError} or {SessionFormatUnsupportedMigrationError} for
 *   an unreadable or unmigratable source generation.
 */
export async function readForeignSessionContent(
  parent: ForeignSessionHeader,
  corpus: readonly ForeignSessionHeader[],
  signal?: AbortSignal,
): Promise<ForeignSessionContent> {
  const children = corpus.filter(candidate =>
    candidate.header.origin === 'subagent' && candidate.header.parentSession === parent.header.id)
  const related = await prepareCatalogFacts(
    parent.header.id,
    children.map(child => ({ header: child.header, path: child.generation.path })),
    parent.generation.compression,
    signal ?? new AbortController().signal,
  )
  const restore = createSessionFormatCatalogWithChildren(related.facts)
  const { artifact } = await readDecodedJsonlSource(
    parent.generation.path,
    parent.generation.version,
    parent.generation.compression,
    {
      createRestore: header => restore.createRestore(header, {
        recovery: 'strict',
        validation: 'current',
      }),
    },
    signal,
  )
  return {
    generation: parent.generation,
    header: toStoredHeader(artifact.header),
    events: artifact.events as unknown as SessionEvent[],
    inheritedEventCount: SessionLogOffset(artifact.inheritedEventCount),
  }
}

/** Read the independently decodable first JSONL record of one generation file. */
function parseHeaderRecord(bytes: Buffer, compression: JsonlCompression): Record<string, unknown> {
  let record: Buffer
  if (compression === 'none') {
    const end = bytes.indexOf(0x0A)
    if (end === -1) throw new Error('empty or header-less session log')
    record = bytes.subarray(0, end)
  } else {
    const { frames } = scanZstdFrames(bytes)
    if (frames.length === 0) throw new Error('empty or header-less Zstandard session log')
    const decoder = createZstdFrameDecoder()
    try {
      const decoded = decoder.decode(bytes, frames).next()
      /* v8 ignore next 2 -- a standard frame that the scanner accepted always decodes to one plaintext chunk, empty at minimum. */
      if (decoded.done) throw new Error('empty or header-less Zstandard session log')
      endOfHeaderFrame(decoded.value)
      record = decoded.value.subarray(0, -1)
    } finally {
      decoder.close()
    }
  }
  let value: unknown
  try {
    value = JSON.parse(record.toString('utf8'))
  } catch (error: unknown) {
    throw new Error('corrupt session log: header line is not valid JSON', { cause: error })
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('corrupt session log: first line is not a JSON object')
  }
  return value as Record<string, unknown>
}

/** Require a Zstandard header frame to contain exactly one header record. */
function endOfHeaderFrame(plaintext: Buffer): void {
  if (plaintext.length === 0 || plaintext.indexOf(0x0A) !== plaintext.length - 1) {
    throw new Error('corrupt Zstandard session log: first frame is not exactly one header line')
  }
}

/** Brand one catalog header into the stored Session metadata vocabulary. */
function toStoredHeader(header: {
  readonly version: number
  readonly id: string
  readonly createdAt: number
  readonly cwd?: string
  readonly parentSession?: string
  readonly isSeeded: boolean
  readonly origin?: 'subagent'
  readonly delegationDepth: number
  readonly agentPreset?: string
}): SessionHeader {
  /* v8 ignore next 3 -- the build-static catalog and the installed Session share one version owner. */
  if (header.version !== sessionFormatCatalog.currentVersion) {
    throw new Error(`format catalog returned non-current logical header v${header.version}`)
  }
  return {
    version: sessionFormatCatalog.currentVersion as SessionHeader['version'],
    id: SessionId(header.id),
    createdAt: header.createdAt,
    ...header.cwd === undefined ? {} : { cwd: header.cwd },
    ...header.parentSession === undefined ? {} : { parentSession: SessionId(header.parentSession) },
    isSeeded: header.isSeeded,
    ...header.origin === undefined ? {} : { origin: header.origin },
    delegationDepth: header.delegationDepth,
    ...header.agentPreset === undefined ? {} : { agentPreset: header.agentPreset },
  }
}
