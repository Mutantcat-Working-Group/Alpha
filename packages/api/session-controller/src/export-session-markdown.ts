/**
 * Export a local session as Markdown.
 *
 * Reads the session's events through the persistence backend and converts
 * user and assistant messages to a readable Markdown transcript.
 * @module @mutantcat/dsh-api-session-controller/export-session-markdown
 */

import type { Context } from '@mutantcat/cordis'
import type { SessionEvent, SessionId } from '@mutantcat/dsh-session'
import type { SessionPersistence } from '@mutantcat/dsh-session-persistence'
import { RemoteError } from '@mutantcat/dsh-typert-protocol'

/** One exported message in the Markdown transcript. */
interface ExportedMessage {
  readonly role: 'user' | 'assistant'
  readonly text: string
}

/**
 * Export one session's messages as a Markdown string.
 *
 * @param ctx - Host context carrying the persistence backend.
 * @param sessionId - Session to export.
 * @param signal - caller cancellation.
 * @returns the Markdown transcript.
 * @throws {RemoteError} when the session cannot be read.
 */
export async function exportSessionMarkdown(
  ctx: Context,
  sessionId: SessionId,
  signal: AbortSignal,
): Promise<string> {
  const persistence = ctx.get('sessionPersistence') as SessionPersistence | undefined
  if (persistence === undefined) {
    throw new RemoteError('gateway/internal', 'no session-persistence backend is mounted', {})
  }
  const snapshot = await persistence.stat(sessionId, { signal })
  if (snapshot === undefined) {
    throw new RemoteError('session/not-found', `session ${sessionId} not found`, { sessionId })
  }
  const handle = await persistence.open(sessionId, 'read', { signal })
  try {
    const result = await handle.read(0, undefined, { signal })
    const messages = extractMessages(result.events)
    return formatMarkdown(snapshot.header, messages)
  } finally {
    await handle.close()
  }
}

/** Extract user and assistant text messages from session events. */
function extractMessages(events: readonly SessionEvent[]): ExportedMessage[] {
  const messages: ExportedMessage[] = []
  for (const event of events) {
    if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
    const data = event.data as { message?: { role?: string; content?: unknown } } | undefined
    const message = data?.message
    if (message === undefined) continue
    const role = message.role === 'assistant' ? 'assistant' : 'user'
    const text = extractText(message.content)
    if (text === '') continue
    messages.push({ role, text })
  }
  return messages
}

/** Extract plain text from message content blocks. */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      if (block !== null && typeof block === 'object') {
        const obj = block as Record<string, unknown>
        if (obj['type'] === 'text' && typeof obj['text'] === 'string') {
          parts.push(obj['text'])
        }
      }
    }
    return parts.join('\n\n')
  }
  return ''
}

/** Format the session header and messages as Markdown. */
function formatMarkdown(
  header: { id: string; createdAt: number; cwd?: string },
  messages: readonly ExportedMessage[],
): string {
  const lines: string[] = []
  lines.push(`# Session ${header.id}`)
  lines.push('')
  lines.push(`- Created: ${new Date(header.createdAt).toISOString()}`)
  if (header.cwd !== undefined) lines.push(`- Working directory: ${header.cwd}`)
  lines.push(`- Messages: ${messages.length}`)
  lines.push('')
  for (const message of messages) {
    const label = message.role === 'user' ? 'User' : 'Assistant'
    lines.push(`## ${label}`)
    lines.push('')
    lines.push(message.text)
    lines.push('')
  }
  return lines.join('\n')
}
