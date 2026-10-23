/**
 * ZCode (Z.ai) session import.
 *
 * Reads Z.ai's ZCode sessions into Alpha's session format. ZCode has two
 * on-disk generations under its data root (`{ZCODE_DATA_BASE_DIR}/.zcode`,
 * default `~/.zcode`):
 *
 * - Current: a SQLite store at `cli/db/db.sqlite` with `session` / `message` /
 *   `part` tables. Message roles live in `message.data.role`; all content lives
 *   in `part.data` (`type` of `text` or `reasoning` carry the text).
 * - Legacy: one pretty-printed JSON snapshot per task at
 *   `v2/sessions/<workspaceHash>/<taskId>.json` with a `meta` object and a flat
 *   `messages` array.
 *
 * The current store is opened read-only so importing never mutates the user's
 * ZCode database. Both generations are discovered from the same root.
 *
 * `node:sqlite` is imported inside the functions that open the store rather
 * than at module scope, so a process that never imports a ZCode session never
 * loads the module and never prints its experimental warning on Node 22.
 * @module @mutantcat/dsh-api-session-controller/zcode-sessions
 */

import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { SessionId, SessionLogOffset } from '@mutantcat/dsh-session'
import type { SessionEvent, SessionHeader } from '@mutantcat/dsh-session'
import { sessionFormatCatalog } from '@mutantcat/dsh-session-format-catalog'
import { asObject, parseJsonObject } from './json-records.ts'
import type { ForeignSessionContent, ForeignSessionFile } from './foreign-format-adapters.ts'

/** Current ZCode session store, relative to the ZCode data root. */
const SQLITE_DB = join('cli', 'db', 'db.sqlite')

/** Legacy session snapshot directory, relative to the ZCode data root. */
const LEGACY_SESSIONS = join('v2', 'sessions')

/** A `workspaceHash` directory name: 12 lowercase hex characters. */
const WORKSPACE_HASH = /^[0-9a-f]{12}$/

/**
 * Report whether a directory is a ZCode data root.
 *
 * Recognizes the current SQLite store (`cli/db/db.sqlite`) or the legacy
 * snapshot tree (`v2/sessions/<workspaceHash>/`).
 *
 * @param root - absolute path the import was pointed at.
 * @returns `true` when the root holds a ZCode current store or legacy tree.
 */
export async function isZcodeRoot(root: string): Promise<boolean> {
  try {
    const { DatabaseSync } = await import('node:sqlite')
    new DatabaseSync(join(root, SQLITE_DB), { readOnly: true }).close()
    return true
  } catch { /* no readable current store */ }
  try {
    const hashes = await readdir(join(root, LEGACY_SESSIONS), { withFileTypes: true })
    return hashes.some(entry => entry.isDirectory() && WORKSPACE_HASH.test(entry.name))
  } catch { /* no legacy snapshot tree */ }
  return false
}

/**
 * List every ZCode session under a data root.
 *
 * SQLite sessions are returned with their `sessionId` set (one database holds
 * many sessions); legacy snapshots are one file per session.
 *
 * @param root - absolute ZCode data root.
 * @param signal - optional cancellation.
 * @returns one entry per discovered session.
 */
export async function listZcodeSessions(
  root: string,
  signal?: AbortSignal,
): Promise<ForeignSessionFile[]> {
  const files: ForeignSessionFile[] = []
  signal?.throwIfAborted()
  await listSqliteSessions(join(root, SQLITE_DB), files, signal)
  await listLegacySessions(join(root, LEGACY_SESSIONS), files, signal)
  return files
}

/**
 * Read and convert one ZCode session to Alpha's format.
 *
 * @param file - a discovered ZCode session (SQLite when `sessionId` is set,
 *   otherwise a legacy snapshot file).
 * @param signal - optional cancellation.
 * @returns the converted session header and events.
 */
export async function readZcodeSession(
  file: ForeignSessionFile,
  signal?: AbortSignal,
): Promise<ForeignSessionContent> {
  signal?.throwIfAborted()
  if (file.sessionId !== undefined) {
    return readSqliteSession(file.path, file.sessionId, signal)
  }
  return readLegacySession(file.path, signal)
}

/** List live sessions from the current SQLite store. */
async function listSqliteSessions(
  dbPath: string,
  files: ForeignSessionFile[],
  signal?: AbortSignal,
): Promise<void> {
  const { DatabaseSync } = await import('node:sqlite')
  let db: DatabaseSync
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
  } catch { return }
  try {
    const rows = db
      .prepare('SELECT id FROM session WHERE time_deleted IS NULL ORDER BY time_created, id')
      .all() as { id: string }[]
    for (const row of rows) {
      signal?.throwIfAborted()
      files.push({ path: dbPath, format: 'zcode', sessionId: row.id })
    }
  } catch { /* not a ZCode store, or an unreadable schema */ } finally {
    db.close()
  }
}

/** List legacy `<workspaceHash>/<taskId>.json` snapshots (soft-deletes excluded). */
async function listLegacySessions(
  sessionsDir: string,
  files: ForeignSessionFile[],
  signal?: AbortSignal,
): Promise<void> {
  let hashes
  try {
    hashes = await readdir(sessionsDir, { withFileTypes: true })
  } catch { return }
  for (const hash of hashes) {
    signal?.throwIfAborted()
    if (!hash.isDirectory() || !WORKSPACE_HASH.test(hash.name)) continue
    const hashDir = join(sessionsDir, hash.name)
    let entries
    try {
      entries = await readdir(hashDir, { withFileTypes: true })
    } catch { continue }
    for (const entry of entries) {
      signal?.throwIfAborted()
      if (entry.isFile() && entry.name.endsWith('.json') && !entry.name.endsWith('.deleted.json')) {
        files.push({ path: join(hashDir, entry.name), format: 'zcode' })
      }
    }
  }
}

/** Convert one SQLite-backed session to Alpha's format. */
async function readSqliteSession(
  dbPath: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<ForeignSessionContent> {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const session = db
      .prepare('SELECT id, directory, time_created FROM session WHERE id = ?')
      .get(sessionId) as { id: string; directory: string; time_created: number } | undefined
    if (session === undefined) {
      throw new Error(`zcode session "${sessionId}" is not present in ${dbPath}`)
    }
    const messages = db
      .prepare('SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created, id')
      .all(sessionId) as { id: string; data: string }[]
    const events: SessionEvent[] = []
    let seq = 0
    for (const message of messages) {
      signal?.throwIfAborted()
      const data = parseJsonObject(message.data)
      const role = data['role']
      if (role !== 'user' && role !== 'assistant') continue
      const text = extractPartText(db, message.id)
      if (text === '') continue
      events.push(buildMessageEvent(role, text, seq))
      seq++
    }
    return {
      header: buildHeader(session.id, session.time_created, session.directory),
      events,
      inheritedEventCount: SessionLogOffset(0),
    }
  } finally {
    db.close()
  }
}

/** Concatenate the text and reasoning of a message's parts in order. */
function extractPartText(db: DatabaseSync, messageId: string): string {
  const parts = db
    .prepare('SELECT data FROM part WHERE message_id = ? ORDER BY sequence, id')
    .all(messageId) as { data: string }[]
  const texts: string[] = []
  for (const part of parts) {
    const data = parseJsonObject(part.data)
    const type = data['type']
    if ((type === 'text' || type === 'reasoning') && typeof data['text'] === 'string' && data['text'] !== '') {
      texts.push(data['text'])
    }
  }
  return texts.join('\n')
}

/** Convert one legacy JSON snapshot to Alpha's format. */
async function readLegacySession(
  path: string,
  signal?: AbortSignal,
): Promise<ForeignSessionContent> {
  signal?.throwIfAborted()
  const raw = await readFile(path, 'utf8')
  const file = parseJsonObject(raw)
  const meta = asObject(file['meta'])
  const sessionId = typeof meta['taskId'] === 'string' && meta['taskId'] !== ''
    ? meta['taskId']
    : basename(path).replace(/\.json$/, '')
  const createdAt = typeof meta['createdAt'] === 'number' ? meta['createdAt'] : Date.now()
  const cwd = typeof meta['workspacePath'] === 'string' ? meta['workspacePath'] : ''
  const messages = Array.isArray(file['messages']) ? file['messages'] : []
  const events: SessionEvent[] = []
  let seq = 0
  for (const message of messages) {
    signal?.throwIfAborted()
    const entry = asObject(message)
    const role = entry['role']
    if (role !== 'user' && role !== 'assistant') continue
    const text = extractLegacyText(entry)
    if (text === '') continue
    events.push(buildMessageEvent(role, text, seq))
    seq++
  }
  return {
    header: buildHeader(sessionId, createdAt, cwd),
    events,
    inheritedEventCount: SessionLogOffset(0),
  }
}

/** Extract a legacy message's text from its ordered parts, else its flat fields. */
function extractLegacyText(message: Record<string, unknown>): string {
  const parts = message['parts']
  if (Array.isArray(parts)) {
    const texts: string[] = []
    for (const part of parts) {
      const entry = asObject(part)
      const type = entry['type']
      if ((type === 'content' || type === 'thought') && typeof entry['content'] === 'string' && entry['content'] !== '') {
        texts.push(entry['content'])
      }
    }
    if (texts.length > 0) return texts.join('\n')
  }
  const thought = typeof message['thought'] === 'string' ? message['thought'] : ''
  const content = typeof message['content'] === 'string' ? message['content'] : ''
  return [thought, content].filter(text => text !== '').join('\n')
}

/** Build one Alpha user/assistant message event. */
function buildMessageEvent(role: 'user' | 'assistant', text: string, seq: number): SessionEvent {
  return {
    type: role === 'user' ? 'user/message' : 'assistant/message',
    data: {
      message: {
        role,
        content: [{ type: 'text', text }],
        source: { kind: role === 'user' ? 'user' : 'assistant' },
        id: `imported-${seq}`,
      },
    },
    surfaceOp: 'append',
  } as unknown as SessionEvent
}

/** Build an Alpha session header for a ZCode session. */
function buildHeader(id: string, createdAt: number, cwd: string): SessionHeader {
  return {
    version: sessionFormatCatalog.currentVersion as SessionHeader['version'],
    id: SessionId(id),
    createdAt,
    ...(cwd === '' ? {} : { cwd }),
    isSeeded: false,
    delegationDepth: 0,
  }
}
