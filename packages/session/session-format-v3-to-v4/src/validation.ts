/** V4 metadata and relationship validation without changing recorded delivery generations. */

import { SessionFormatError, isSessionFormatJsonObject, sessionFormatCount } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatArtifact, SessionFormatEvent, SessionFormatHeader, SessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import { assertReleasedV3Header, restoreReleasedV3Artifact } from '@deepseek-ai/dsh-session-format-v2-to-v3'

/**
 * Validate V4 metadata with the unchanged released V3 header fields.
 * @param header - decoded V4 Session header.
 */
export function assertReleasedV4Header(header: SessionFormatHeader): void {
  if (header.version !== 4) throw new SessionFormatError('expected format v4 header')
  assertReleasedV3Header({ ...header, version: 3 })
}

/**
 * Validate V4 relationships and delivery coordinates while retaining the original artifact.
 * @param artifact - complete detached V4 artifact.
 * @param knownEventTypes - event types understood by the installed Session package.
 * @returns the same validated artifact and event objects.
 */
export function restoreReleasedV4Artifact(artifact: SessionFormatArtifact, knownEventTypes: ReadonlySet<string>): SessionFormatArtifact {
  assertReleasedV4Header(artifact.header)
  const events = artifact.events.map((event): SessionFormatEvent => {
    validateDeliveryAccepted(event, 4)
    if (event.type !== 'session-log-deepseek/delivery-accepted') return event
    const data = event.data as SessionFormatJsonObject
    const version = data['sessionFormatVersion']
    // Only this private relationship view substitutes generations; recorded delivery identities stay unchanged.
    return version === 4 || version === 3
      ? { ...event, data: { ...data, sessionFormatVersion: version === 4 ? 3 : 2 } }
      : event
  })
  restoreReleasedV3Artifact({ ...artifact, header: { ...artifact.header, version: 3 }, events }, knownEventTypes)
  return artifact
}

/**
 * Validate delivery generation and active-generation coordinates before evaluating ownership.
 * @param event - decoded event whose delivery payload may be inspected.
 * @param currentVersion - generation whose watermark coordinates are active.
 * @returns the active delivery's nonempty Session id, or undefined for other events and generations.
 */
export function validateDeliveryAccepted(event: SessionFormatEvent, currentVersion: 3 | 4): string | undefined {
  if (event.type !== 'session-log-deepseek/delivery-accepted') return undefined
  const data = event.data
  if (!isSessionFormatJsonObject(data)) throw new SessionFormatError('delivery-accepted data must be an object')
  const version = sessionFormatCount(data['sessionFormatVersion'] === undefined ? 0 : data['sessionFormatVersion'], 'delivery sessionFormatVersion')
  if (version !== currentVersion) return undefined
  const throughSeq = sessionFormatCount(data['throughSeq'], 'delivery throughSeq')
  if (throughSeq >= event.seq) throw new SessionFormatError('delivery throughSeq must precede its marker')
  const id = data['sessionId']
  if (typeof id !== 'string' || id.length === 0) throw new SessionFormatError('delivery requires a nonempty Session id')
  return id
}
