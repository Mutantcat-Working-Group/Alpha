/**
 * Multi-format foreign session import adapters.
 *
 * Detects the format of a foreign sessions root and converts foreign
 * sessions (Codex, Claude Code, ZCode) into Alpha's session format. The DSH
 * format is handled by the existing `foreign.ts` module; this module
 * adds support for other AI coding tools.
 *
 * Each adapter produces Alpha-compatible session headers and events
 * that the existing import pipeline can publish.
 * @module @mutantcat/dsh-api-session-controller/foreign-format-adapters
 */

import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { SessionId, SessionLogOffset } from '@mutantcat/dsh-session'
import type { SessionEvent, SessionHeader } from '@mutantcat/dsh-session'
import { sessionFormatCatalog } from '@mutantcat/dsh-session-format-catalog'
import { jsonString, parseJsonlRecord } from './json-records.ts'
import { isZcodeRoot, listZcodeSessions, readZcodeSession } from './zcode-sessions.ts'

/** Supported foreign session formats. */
export type ForeignFormat = 'dsh' | 'codex' | 'claude' | 'zcode'

/** One discovered foreign session file. */
export interface ForeignSessionFile {
  /** Absolute path of the session file. */
  readonly path: string
  /** Detected format. */
  readonly format: ForeignFormat
  /**
   * Session id within a store that holds many sessions in one file (the ZCode
   * SQLite database). Omitted for one-file-per-session formats, which derive
   * the id from the file itself.
   */
  readonly sessionId?: string
}

/** Converted foreign session content in Alpha's format. */
export interface ForeignSessionContent {
  readonly header: SessionHeader
  readonly events: SessionEvent[]
  readonly inheritedEventCount: SessionLogOffset
}

/**
 * Detect the foreign session format of a root directory.
 *
 * Checks for format-specific directory structures:
 * - Codex: `sessions/YYYY/MM/DD/rollout-*.jsonl`
 * - Claude: `projects/<project>/<session>.jsonl`
 * - ZCode: `cli/db/db.sqlite` (current) or `v2/sessions/<workspaceHash>/` (legacy)
 * - DSH: `<project>/<session>/session.vN.jsonl` (handled by existing foreign.ts)
 *
 * @param root - absolute path to the foreign sessions root.
 * @returns the detected format, or `'dsh'` as the default.
 */
export async function detectForeignFormat(root: string): Promise<ForeignFormat> {
  // Codex: check for sessions/YYYY/MM/DD/ structure
  try {
    const sessionsDir = join(root, 'sessions')
    const years = await readdir(sessionsDir, { withFileTypes: true })
    if (years.some(e => e.isDirectory() && /^\d{4}$/.test(e.name))) {
      return 'codex'
    }
  } catch { /* not codex */ }

  // Claude: check for projects/ directory with .jsonl files
  try {
    const projectsDir = join(root, 'projects')
    const projects = await readdir(projectsDir, { withFileTypes: true })
    for (const project of projects) {
      if (!project.isDirectory()) continue
      const files = await readdir(join(projectsDir, project.name))
      if (files.some(f => f.endsWith('.jsonl'))) {
        return 'claude'
      }
    }
  } catch { /* not claude */ }

  // ZCode: current SQLite store or legacy snapshot tree
  if (await isZcodeRoot(root)) {
    return 'zcode'
  }

  // Default to DSH format
  return 'dsh'
}

/**
 * List all session files under a foreign root for the given format.
 *
 * @param root - absolute path to the foreign sessions root.
 * @param format - the detected format.
 * @param signal - optional cancellation.
 * @returns one entry per discovered session file.
 */
export async function listForeignSessionFiles(
  root: string,
  format: ForeignFormat,
  signal?: AbortSignal,
): Promise<ForeignSessionFile[]> {
  const files: ForeignSessionFile[] = []
  signal?.throwIfAborted()

  if (format === 'codex') {
    await walkCodexSessions(join(root, 'sessions'), files, signal)
  } else if (format === 'claude') {
    await walkClaudeSessions(join(root, 'projects'), files, signal)
  } else if (format === 'zcode') {
    return listZcodeSessions(root, signal)
  }

  return files
}

/** Recursively find rollout-*.jsonl files under the codex sessions tree. */
async function walkCodexSessions(
  dir: string,
  files: ForeignSessionFile[],
  signal?: AbortSignal,
): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch { return }
  for (const entry of entries) {
    signal?.throwIfAborted()
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkCodexSessions(fullPath, files, signal)
    } else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
      files.push({ path: fullPath, format: 'codex' })
    }
  }
}

/** Find *.jsonl files under each claude project directory. */
async function walkClaudeSessions(
  projectsDir: string,
  files: ForeignSessionFile[],
  signal?: AbortSignal,
): Promise<void> {
  let projects
  try {
    projects = await readdir(projectsDir, { withFileTypes: true })
  } catch { return }
  for (const project of projects) {
    signal?.throwIfAborted()
    if (!project.isDirectory()) continue
    const projectDir = join(projectsDir, project.name)
    let entries
    try {
      entries = await readdir(projectDir, { withFileTypes: true })
    } catch { continue }
    for (const entry of entries) {
      signal?.throwIfAborted()
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push({ path: join(projectDir, entry.name), format: 'claude' })
      }
    }
  }
}

/**
 * Read and convert a foreign session file to Alpha's format.
 *
 * @param file - the foreign session file to read.
 * @param signal - optional cancellation.
 * @returns the converted session header and events.
 */
export async function readForeignSession(
  file: ForeignSessionFile,
  signal?: AbortSignal,
): Promise<ForeignSessionContent> {
  signal?.throwIfAborted()
  if (file.format === 'zcode') {
    return readZcodeSession(file, signal)
  }
  const content = await readFile(file.path, 'utf8')
  const lines = content.split('\n').filter(line => line.trim() !== '')

  if (file.format === 'codex') {
    return convertCodexSession(lines, file.path, signal)
  }
  return convertClaudeSession(lines, file.path, signal)
}

/** Convert Codex JSONL lines to Alpha session format. */
function convertCodexSession(
  lines: string[],
  sourcePath: string,
  signal?: AbortSignal,
): ForeignSessionContent {
  const session = newJsonlSession()

  forEachJsonlRecord(lines, (record) => {
    const type = record['type'] as string
    const payload = record['payload'] as Record<string, unknown> | undefined

    if (type === 'session_meta' && payload) {
      session.sessionId = jsonString(payload['session_id']) ?? jsonString(payload['id']) ?? ''
      const ts = jsonString(record['timestamp'])
      if (ts) session.createdAt = new Date(ts).getTime()
      session.cwd = jsonString(payload['cwd']) ?? ''
    } else if (type === 'response_item' && payload) {
      const event = convertCodexResponseItem(payload, session.events.length)
      if (event) session.events.push(event)
    }
  }, signal)

  if (session.sessionId === '') {
    // A rollout name carries the session UUID the writer used everywhere else.
    const fileName = sessionIdFromFileName(sourcePath)
    session.sessionId = fileName.match(CODEX_SESSION_UUID)?.[1] ?? fileName
  }

  return foreignContent(session.sessionId, session.createdAt, session.cwd, session.events)
}

/** Convert one Codex response_item to an Alpha event, or null to skip. */
function convertCodexResponseItem(
  payload: Record<string, unknown>,
  seq: number,
): SessionEvent | undefined {
  const role = payload['role'] as string | undefined
  const content = payload['content']

  if (role === 'user' || role === 'assistant') {
    const textContent = extractTextContent(content)
    if (textContent === '') return undefined
    return importedMessageEvent(role, textContent, seq)
  }

  return undefined
}

/** Convert Claude Code JSONL lines to Alpha session format. */
function convertClaudeSession(
  lines: string[],
  sourcePath: string,
  signal?: AbortSignal,
): ForeignSessionContent {
  const session = newJsonlSession()

  forEachJsonlRecord(lines, (record) => {
    const type = record['type'] as string

    if (type === 'user' || type === 'assistant') {
      const message = record['message'] as Record<string, unknown> | undefined
      if (!message) return

      if (session.sessionId === '') {
        session.sessionId = jsonString(record['sessionId']) ?? ''
        const ts = jsonString(record['timestamp'])
        if (ts) session.createdAt = new Date(ts).getTime()
        session.cwd = jsonString(record['cwd']) ?? ''
      }

      const role = message['role'] as string
      const textContent = extractTextContent(message['content'])
      if (textContent === '') return

      session.events.push(importedMessageEvent(role, textContent, session.events.length))
    }
  }, signal)

  if (session.sessionId === '') session.sessionId = sessionIdFromFileName(sourcePath)

  return foreignContent(session.sessionId, session.createdAt, session.cwd, session.events)
}

/** Extract text content from various content formats. */
function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      if (typeof block === 'string') {
        parts.push(block)
      } else if (block && typeof block === 'object') {
        const obj = block as Record<string, unknown>
        if ((obj['type'] === 'text' || obj['type'] === 'input_text') && typeof obj['text'] === 'string') {
          parts.push(obj['text'])
        }
      }
    }
    return parts.join('\n')
  }
  return ''
}

/** What one foreign JSONL adapter collects while walking a session file. */
interface JsonlSession {
  /** The id to import the session under, empty until a record carried one. */
  sessionId: string
  /** When the session started, until a record carried a timestamp. */
  createdAt: number
  /** The working directory the foreign writer recorded, if any. */
  cwd: string
  /** The converted events, in the order the foreign writer wrote them. */
  events: SessionEvent[]
}

/** The starting point every foreign JSONL session is read into. */
function newJsonlSession(): JsonlSession {
  return { sessionId: '', createdAt: Date.now(), cwd: '', events: [] }
}

/**
 * Hands every parsed line of a foreign JSONL session to a visitor.
 *
 * Foreign writers append to these files and never rewrite them, so a
 * truncated final line is normal and is skipped rather than reported.
 *
 * @param lines - the non-empty lines of one foreign session file.
 * @param visit - called once per line that carried a JSON object.
 * @param signal - optional cancellation.
 */
function forEachJsonlRecord(
  lines: readonly string[],
  visit: (record: Record<string, unknown>) => void,
  signal?: AbortSignal,
): void {
  for (const line of lines) {
    signal?.throwIfAborted()
    const record = parseJsonlRecord(line)
    if (record) visit(record)
  }
}

/**
 * Wrap one imported message as an Alpha session event.
 *
 * Only the role decides which of the two message surfaces an event lands on,
 * so a role the foreign writer spelled anything other than `user` arrives as
 * an assistant message.
 *
 * @param role - the foreign writer's role label.
 * @param text - the flattened text of the message.
 * @param seq - the event index within the imported session.
 * @returns the event to append to the imported log.
 */
function importedMessageEvent(role: string, text: string, seq: number): SessionEvent {
  return {
    type: role === 'user' ? 'user/message' : 'assistant/message',
    data: {
      message: {
        role,
        content: [{ type: 'text', text }],
        source: role === 'user' ? { kind: 'user' } : { kind: 'assistant' },
        id: `imported-${seq}`,
      },
    },
    surfaceOp: 'append',
  } as unknown as SessionEvent
}

/** Session UUID a Codex rollout file name is built around. */
const CODEX_SESSION_UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/

/**
 * Derive a session id from a foreign session file name.
 *
 * A writer that recorded no id inside the file still names the file after the
 * session, which leaves the name as the last resort.
 *
 * @param sourcePath - absolute path of the foreign session file.
 * @returns the file name without its `.jsonl` suffix.
 */
function sessionIdFromFileName(sourcePath: string): string {
  return basename(sourcePath).replace(/\.jsonl$/, '')
}

/**
 * Build the converted session both JSONL adapters return.
 *
 * The header carries only what the foreign writer recorded, so a session
 * discovered without a working directory omits it instead of importing an
 * empty one.
 *
 * @param sessionId - the id to import the session under.
 * @param createdAt - when the foreign session started.
 * @param cwd - the working directory the foreign writer recorded, if any.
 * @param events - the converted events in foreign order.
 * @returns the converted content with nothing inherited from an earlier log.
 */
function foreignContent(
  sessionId: string,
  createdAt: number,
  cwd: string,
  events: SessionEvent[],
): ForeignSessionContent {
  const header: SessionHeader = {
    version: sessionFormatCatalog.currentVersion as SessionHeader['version'],
    id: SessionId(sessionId),
    createdAt,
    ...cwd === '' ? {} : { cwd },
    isSeeded: false,
    delegationDepth: 0,
  }
  return { header, events, inheritedEventCount: SessionLogOffset(0) }
}
