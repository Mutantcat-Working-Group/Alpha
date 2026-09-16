/** Streaming V3-to-V4 identity conversion with inherited cuts and delivery activation guards. */

import { SessionFormatError, SessionFormatUnsupportedMigrationError, defineSessionFormatMigration, sessionFormatCount } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent, SessionFormatEventRun, SessionFormatJsonObject, SessionFormatMigrationContext, SessionFormatMigrationStage, SessionFormatMigrationStageInput } from '@deepseek-ai/dsh-session-format'
import { assertReleasedV3Header } from '@deepseek-ai/dsh-session-format-v2-to-v3'
import { assertReleasedV4Header, validateDeliveryAccepted } from './validation.ts'

/** Adjacent migration preserves admitted V3 event values and coordinates. */
export const sessionFormatV3ToV4 = defineSessionFormatMigration({
  name: '@deepseek-ai/dsh-session-format-v3-to-v4',
  fromVersion: 3,
  toVersion: 4,
  migrateHeader(header) {
    assertReleasedV3Header(header)
    return { ...header, version: 4 }
  },
  createStage(input) { return new ReleasedV3ToV4Stage(input) },
  validateTargetHeader: assertReleasedV4Header,
})

class ReleasedV3ToV4Stage implements SessionFormatMigrationStage {
  readonly headerInheritedEventCount?: number
  private cut: number | undefined
  private nextSeq = 0
  private foreignDeliverySeq: number | undefined

  constructor(private readonly input: SessionFormatMigrationStageInput) {
    this.cut = input.sourceHeader.isSeeded ? undefined : 0
    if (!input.sourceHeader.isSeeded) this.headerInheritedEventCount = 0
  }

  transformEvent(event: SessionFormatEvent, context: SessionFormatMigrationContext): void {
    if (event.seq !== this.nextSeq++) throw new SessionFormatError('format v3 source events must be dense')
    if (event.type === 'session/end-seed' && (event.data as SessionFormatJsonObject)['inherited'] === true) {
      if (!this.input.sourceHeader.isSeeded) throw new SessionFormatError('unseeded format v3 Session contains an inherited end-seed marker')
      this.cut = event.seq
    }
    const deliveryId = validateDeliveryAccepted(event, 3)
    if (event.type === 'session-log-deepseek/delivery-accepted') {
      if ((event.data as SessionFormatJsonObject)['sessionFormatVersion'] === 4) {
        throw new SessionFormatUnsupportedMigrationError('format v3 delivery marker claims target format v4')
      }
      if (deliveryId !== undefined && deliveryId !== this.input.sourceHeader.id) this.foreignDeliverySeq = event.seq
    }
    context.emitEvent(event)
  }

  transformRun(run: SessionFormatEventRun, context: SessionFormatMigrationContext): void {
    for (const event of run.expand()) this.transformEvent(event, context)
  }

  finish(_context: SessionFormatMigrationContext): number {
    const cut = sessionFormatCount(this.cut, 'format v3 inherited event count')
    if (this.input.sourceInheritedEventCount !== undefined && cut !== this.input.sourceInheritedEventCount) {
      throw new SessionFormatError('format v3 inherited cut disagrees with its source marker')
    }
    if (this.foreignDeliverySeq !== undefined
      && (this.input.sourceHeader.parentSession === undefined || this.foreignDeliverySeq >= cut)) {
      throw new SessionFormatError('current-generation delivery marker names the wrong Session')
    }
    return cut
  }
}
