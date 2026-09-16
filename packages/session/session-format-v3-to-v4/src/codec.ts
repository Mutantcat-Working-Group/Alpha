/** V4 framing retains released V3 event encoding and structural admission. */

import { SessionFormatError, isSessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatCodec, SessionFormatCurrentEncoder, SessionFormatHeader } from '@deepseek-ai/dsh-session-format'
import { assertV3RowAdmission, releasedV3SessionFormatCodec } from '@deepseek-ai/dsh-session-format-v2-to-v3'
import { assertReleasedV4Header } from './validation.ts'

/** V4 codec preserves the released V3 physical event representation. */
export const releasedV4SessionFormatCodec = Object.freeze({
  version: 4,
  decodeHeader(value: unknown) {
    return { ...releasedV3SessionFormatCodec.decodeHeader(physicalV3(value)), version: 4 }
  },
  createDecoder(value, recovery) {
    const decoder = releasedV3SessionFormatCodec.createDecoder(physicalV3(value), recovery)
    return { ...decoder, header: { ...decoder.header, version: 4 } }
  },
  encodeHeader(header, inheritedEventCount) {
    assertReleasedV4Header(header)
    return { ...releasedV3SessionFormatCodec.encodeHeader({ ...header, version: 3 }, inheritedEventCount), version: 4 }
  },
  encodeEvent: releasedV3SessionFormatCodec.encodeEvent,
} satisfies SessionFormatCodec & SessionFormatCurrentEncoder)

/**
 * Apply V4 structural admission before a scanner discards a recoverable suffix.
 * @param row - parsed physical row before framing and source-event range decoding.
 */
export function assertV4RowAdmission(row: unknown): void {
  assertV3RowAdmission(row)
}

function physicalV3(value: unknown): SessionFormatHeader {
  if (!isSessionFormatJsonObject(value) || value['version'] !== 4) {
    throw new SessionFormatError('expected format v4 physical Session header')
  }
  return { ...value, version: 3 } as SessionFormatHeader
}
