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
import { join } from 'node:path'
import { SessionId, SessionLogOffset } from '@mutantcat/dsh-session'
import type { SessionEvent, SessionHeader } from '@mutantcat/dsh-session'
import { sessionFormatCatalog } from '@mutantcat/dsh-session-format-catalog'
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
  let sessionId = ''
  let createdAt = Date.now()
  let cwd = ''
  const events: SessionEvent[] = []
  let seq = 0

  for (const line of lines) {
    signal?.throwIfAborted()
    let record: Record<string, unknown>
    try {
      record = JSON.parse(line)
    } catch { continue }

    const type = record['type'] as string
    const payload = record['payload'] as Record<string, unknown> | undefined

    if (type === 'session_meta' && payload) {
      sessionId = (payload['session_id'] as string) ?? (payload['id'] as string) ?? ''
      const ts = record['timestamp'] as string | undefined
      if (ts) createdAt = new Date(ts).getTime()
      cwd = (payload['cwd'] as string) ?? ''
    } else if (type === 'response_item' && payload) {
      const event = convertCodexResponseItem(payload, seq, sourcePath)
      if (event) {
        events.push(event)
        seq++
      }
    }
  }

  if (sessionId === '') {
    // Derive a session ID from the filename
    const basename = sourcePath.split('/').pop() ?? ''
    const uuidMatch = basename.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/)
    sessionId = uuidMatch?.[1] ?? basename.replace(/\.jsonl$/, '')
  }

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

/** Convert one Codex response_item to an Alpha event, or null to skip. */
function convertCodexResponseItem(
  payload: Record<string, unknown>,
  seq: number,
  _sourcePath: string,
): SessionEvent | undefined {
  const role = payload['role'] as string | undefined
  const content = payload['content']

  if (role === 'user' || role === 'assistant') {
    const textContent = extractTextContent(content)
    if (textContent === '') return undefined
    return {
      type: role === 'user' ? 'user/message' : 'assistant/message',
      data: {
        message: {
          role,
          content: [{ type: 'text', text: textContent }],
          source: role === 'user' ? { kind: 'user' } : { kind: 'assistant' },
          id: `imported-${seq}`,
        },
      },
      surfaceOp: 'append',
    } as unknown as SessionEvent
  }

  return undefined
}

/** Convert Claude Code JSONL lines to Alpha session format. */
function convertClaudeSession(
  lines: string[],
  sourcePath: string,
  signal?: AbortSignal,
): ForeignSessionContent {
  let sessionId = ''
  let createdAt = Date.now()
  let cwd = ''
  const events: SessionEvent[] = []
  let seq = 0

  for (const line of lines) {
    signal?.throwIfAborted()
    let record: Record<string, unknown>
    try {
      record = JSON.parse(line)
    } catch { continue }

    const type = record['type'] as string

    if (type === 'user' || type === 'assistant') {
      const message = record['message'] as Record<string, unknown> | undefined
      if (!message) continue

      if (sessionId === '') {
        sessionId = (record['sessionId'] as string) ?? ''
        const ts = record['timestamp'] as string | undefined
        if (ts) createdAt = new Date(ts).getTime()
        cwd = (record['cwd'] as string) ?? ''
      }

      const role = message['role'] as string
      const content = message['content']
      const textContent = extractTextContent(content)
      if (textContent === '') continue

      events.push({
        type: role === 'user' ? 'user/message' : 'assistant/message',
        data: {
          message: {
            role,
            content: [{ type: 'text', text: textContent }],
            source: role === 'user' ? { kind: 'user' } : { kind: 'assistant' },
            id: `imported-${seq}`,
          },
        },
        surfaceOp: 'append',
      } as unknown as SessionEvent)
      seq++
    }
  }

  if (sessionId === '') {
    const basename = sourcePath.split('/').pop() ?? ''
    sessionId = basename.replace(/\.jsonl$/, '')
  }

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
