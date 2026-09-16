/** V4 fork-result admission for the private released-validator view. */

import { SessionFormatError, isSessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'

/**
 * Present a V4 not-started fork result to the frozen V3 validators.
 * Only the private view changes; codecs preserve the original result data.
 * Tool-result rows encode one event each. Replacements retain the original
 * identity suffix while the released validator checks their surface references.
 * @param row - logical event or physical event row.
 * @returns the original row, or its validated fork result represented as a V3 repair.
 */
export function forkResultValidationView<T>(row: T): T {
  if (!isSessionFormatJsonObject(row) || row['type'] !== 'tool/result') return row
  const data = row['data']
  if (!isSessionFormatJsonObject(data)) return row
  const error = data['error']
  const message = data['message']
  if (!isSessionFormatJsonObject(error) || error['code'] !== 'TOOL_NOT_STARTED'
    || !isSessionFormatJsonObject(message) || typeof message['id'] !== 'string'
    || !message['id'].startsWith('forked-tool-result-')) return row
  const source = message['source']
  const callId = isSessionFormatJsonObject(source) ? source['callId'] : undefined
  const prefix = `forked-tool-result-${String(callId)}-`
  const suffix = message['id'].slice(prefix.length)
  const operation = row['surfaceOp']
  const replacement = isSessionFormatJsonObject(operation) && operation['op'] === 'replace'
  const sequence = Number(suffix)
  const content = message['content']
  const block: unknown = Array.isArray(content) && content.length === 1 ? content[0] : undefined
  const result = isSessionFormatJsonObject(block) ? block['content'] : undefined
  const text: unknown = Array.isArray(result) && result.length === 1 ? result[0] : undefined
  if (typeof callId !== 'string' || !message['id'].startsWith(prefix)
    || !/^(0|[1-9]\d*)$/.test(suffix) || !Number.isSafeInteger(sequence)
    || (replacement ? typeof row['seq'] !== 'number' || sequence >= row['seq'] : sequence !== row['seq'])
    || error['name'] !== 'ToolNotStartedError'
    || (!replacement && (row['sourceEventSeqs'] !== undefined || operation !== 'append')) || !isSessionFormatJsonObject(block)
    || block['type'] !== 'tool-result' || block['isError'] !== true || block['toolCallId'] !== callId
    || !isSessionFormatJsonObject(text) || text['type'] !== 'text' || typeof text['text'] !== 'string') {
    throw new SessionFormatError('invalid V4 not-started fork result')
  }
  const canonical: SessionFormatJsonObject = {
    ...data,
    message: {
      ...message,
      id: `interrupted-tool-result-${callId}-${suffix}`,
      content: [{ ...block, content: [{ ...text, text: 'The tool call was interrupted before the Harness recorded it as started. Retry it if it is still needed.' }] }],
    },
  }
  return { ...row, data: canonical }
}
