/** Retired native syntax remains a hard refusal even after a recoverable physical-row failure. */

import { SessionFormatError, SessionFormatUnsupportedMigrationError, isSessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'

/**
 * Refuse retired request-header system text and predecessor PTC tags without interpreting extension payloads.
 * @param row - parsed physical row or complete native logical event.
 */
export function assertV4RetiredSyntax(row: unknown): void {
  if (!isSessionFormatJsonObject(row)) return
  if ((row['type'] === 'tool/code-dispatch-start' || row['type'] === 'tool/code-dispatch') && row['ignorable'] !== true) {
    throw new SessionFormatUnsupportedMigrationError(`format v4 rejects retired event type ${row['type']}`)
  }
  if (row['type'] !== 'request/header') return
  const data = row['data']
  if (!isSessionFormatJsonObject(data) || !isSessionFormatJsonObject(data['header'])) {
    throw new SessionFormatError('format v4 request/header requires data and header objects')
  }
  if (Object.hasOwn(data['header'], 'system')) {
    throw new SessionFormatError('format v4 request/header rejects retired header.system')
  }
}
