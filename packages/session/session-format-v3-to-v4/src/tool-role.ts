/** First-class tool-role messages in the V4 representation. */

import { SessionFormatError, SessionFormatUnsupportedMigrationError, isSessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent, SessionFormatJsonValue } from '@deepseek-ai/dsh-session-format'

const WRAPPER_FIELDS = new Set(['type', 'toolCallId', 'content', 'isError'])

function resultContent(value: SessionFormatJsonValue | undefined, subject: string): SessionFormatJsonValue[] {
  if (!Array.isArray(value)) throw new SessionFormatError(`${subject} tool-result content must be an array`)
  if (value.some(block => isSessionFormatJsonObject(block) && block['type'] === 'tool-result')) {
    throw new SessionFormatUnsupportedMigrationError(
      `${subject} contains a nested tool-result; migration cannot preserve its call identity and error status`,
    )
  }
  return value as SessionFormatJsonValue[]
}

/**
 * Lift one released-V3 wrapper tool/result row into the first-class V4 message.
 * Validate the wrapper before dropping it so malformed historical content is
 * rejected instead of being silently truncated.
 * @param event - released wrapper tool/result event.
 * @returns the same event with a first-class tool-role message.
 * @throws {SessionFormatUnsupportedMigrationError} when nested results, wrapper
 * extensions, or conflicting target fields cannot be preserved.
 */
export function liftToolResult(event: SessionFormatEvent): SessionFormatEvent {
  if (event.type !== 'tool/result' || !isSessionFormatJsonObject(event.data)) return event
  const data = event.data
  const message = data['message']
  if (!isSessionFormatJsonObject(message) || message['role'] !== 'user') return event
  const source = message['source']
  const callId = isSessionFormatJsonObject(source) ? source['callId'] : undefined
  const content = message['content']
  const wrapper = Array.isArray(content) && content.length === 1 && isSessionFormatJsonObject(content[0])
    ? content[0]
    : undefined
  const id = message['id']
  if (typeof id !== 'string' || id.length === 0
    || !isSessionFormatJsonObject(source) || source['kind'] !== 'tool'
    || typeof callId !== 'string' || callId.length === 0
    || wrapper === undefined || wrapper['type'] !== 'tool-result'
    || wrapper['toolCallId'] !== callId) {
    throw new SessionFormatError(`format v3 ${event.type} at seq ${event.seq} requires exactly one tool-result wrapper matching its tool source`)
  }
  const isError = wrapper['isError']
  if (isError !== undefined && typeof isError !== 'boolean') {
    throw new SessionFormatError(`format v3 ${event.type} at seq ${event.seq} tool-result isError must be boolean`)
  }
  const unmapped = Object.keys(wrapper).find(field => !WRAPPER_FIELDS.has(field))
  if (unmapped !== undefined) {
    throw new SessionFormatUnsupportedMigrationError(
      `format v3 ${event.type} at seq ${event.seq} has unmapped tool-result field ${JSON.stringify(unmapped)}`,
    )
  }
  if (Object.hasOwn(message, 'toolCallId') && message['toolCallId'] !== callId) {
    throw new SessionFormatUnsupportedMigrationError(`format v3 ${event.type} at seq ${event.seq} has conflicting outer toolCallId`)
  }
  if (Object.hasOwn(message, 'isError') && (typeof message['isError'] !== 'boolean' || message['isError'] !== (isError ?? false))) {
    throw new SessionFormatUnsupportedMigrationError(`format v3 ${event.type} at seq ${event.seq} has conflicting outer isError`)
  }
  const targetIsError = isError ?? message['isError']
  // Recorded replay compares serialized messages with createToolResultMessage's field order.
  const targetMessage: Record<string, SessionFormatJsonValue> = {
    role: 'tool',
    source,
    toolCallId: callId,
    content: resultContent(wrapper['content'] as SessionFormatJsonValue | undefined, `format v3 ${event.type} at seq ${event.seq}`),
    ...(targetIsError === undefined ? {} : { isError: targetIsError }),
    id,
  }
  const extensions = Object.fromEntries(Object.entries(message).filter(([key]) => !Object.hasOwn(targetMessage, key)))
  return { ...event, data: { ...data, message: { ...targetMessage, ...extensions } } }
}

/**
 * Validate the native V4 first-class tool-role message of one tool/result row.
 * @param event - canonical V4 event.
 * @throws {SessionFormatError} when the row is not an exact first-class tool result.
 */
export function assertV4ToolResultMessage(event: SessionFormatEvent): void {
  if (event.type !== 'tool/result') return
  const subject = `format v4 ${event.type} at seq ${event.seq}`
  const data = event.data
  if (!isSessionFormatJsonObject(data)) throw new SessionFormatError(`${subject} data must be an object`)
  const message = data['message']
  if (!isSessionFormatJsonObject(message)) throw new SessionFormatError(`${subject} message must be an object`)
  const id = message['id']
  const role = message['role']
  const toolCallId = message['toolCallId']
  const source = message['source']
  const isError = message['isError']
  const content = message['content']
  const sourceCallId = isSessionFormatJsonObject(source) ? source['callId'] : undefined
  if (typeof id !== 'string' || id.length === 0) {
    throw new SessionFormatError(`${subject} requires a first-class message with a string id`)
  }
  if (role !== 'tool') throw new SessionFormatError(`${subject} requires a tool-role message`)
  if (typeof toolCallId !== 'string' || toolCallId.length === 0 || sourceCallId !== toolCallId) {
    throw new SessionFormatError(`${subject} requires toolCallId matching its tool source`)
  }
  if (!isSessionFormatJsonObject(source) || source['kind'] !== 'tool') {
    throw new SessionFormatError(`${subject} requires a tool source`)
  }
  if (!Array.isArray(content)) throw new SessionFormatError(`${subject} requires array content`)
  if (content.some(block => isSessionFormatJsonObject(block) && block['type'] === 'tool-result')) {
    throw new SessionFormatError(`${subject} content must not contain a released tool-result wrapper`)
  }
  if (isError !== undefined && typeof isError !== 'boolean') {
    throw new SessionFormatError(`${subject} isError must be boolean when present`)
  }
  if (data['error'] !== undefined && isError !== true) {
    throw new SessionFormatError(`${subject} carries error metadata for a non-error tool result`)
  }
}
