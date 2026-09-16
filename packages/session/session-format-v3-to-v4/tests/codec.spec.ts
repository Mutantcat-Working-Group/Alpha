import { describe, expect, it } from 'vitest'
import { SessionFormatEventCollector } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent, SessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { releasedV3SessionFormatCodec as previousCodec } from '@deepseek-ai/dsh-session-format-v2-to-v3'
import { assertReleasedV4Header, assertV4RowAdmission, releasedV3SessionFormatCodec, releasedV4SessionFormatCodec, restoreReleasedV4Artifact } from '../src/index.ts'

const header = { version: 4, id: 'parent', createdAt: 1, isSeeded: false, delegationDepth: 0 }
const fact: SessionFormatEvent = { type: 'feedback/record', seq: 0, time: 1, data: { text: 'retained' } }
const types = new Set(['feedback/record', 'session-log-deepseek/delivery-accepted', 'session/end-seed'])
const delivery = (version: number | undefined, sessionId = header.id): SessionFormatEvent => ({
  type: 'session-log-deepseek/delivery-accepted', seq: 1, time: 2,
  data: { sessionId, throughSeq: 0, ...(version === undefined ? {} : { sessionFormatVersion: version }) },
})

function restore(events: readonly SessionFormatEvent[], sourceHeader = header) {
  return restoreReleasedV4Artifact({ header: sourceHeader, events, inheritedEventCount: 0 }, types)
}

describe('V4 framing and restoration', () => {
  it('reuses the released V3 codec and round trips unchanged V3 event encoding', () => {
    expect(releasedV3SessionFormatCodec).toBe(previousCodec)
    const physical = releasedV4SessionFormatCodec.encodeHeader(header, 0)
    expect(physical).toEqual({ type: 'session', ...header })
    expect(releasedV4SessionFormatCodec.decodeHeader(physical)).toEqual(header)
    const decoder = releasedV4SessionFormatCodec.createDecoder(physical, 'strict')
    const output = new SessionFormatEventCollector()
    expect(decoder.header).toEqual(header)
    const row = releasedV4SessionFormatCodec.encodeEvent(fact)
    expect(row).toEqual(releasedV3SessionFormatCodec.encodeEvent(fact))
    decoder.decodeRow(row, output)
    expect(decoder.finish(output)).toBe(0)
    expect(output.values).toEqual([fact])
    const artifact = { header, events: output.values, inheritedEventCount: 0 }
    expect(restoreReleasedV4Artifact(artifact, types)).toBe(artifact)
  })

  it('rejects mismatched versions and malformed logical and physical metadata', () => {
    expect(() => { assertReleasedV4Header({ ...header, version: 3 }) }).toThrow('v4 header')
    expect(() => { assertReleasedV4Header({ ...header, createdAt: -1 }) }).toThrow('createdAt')
    expect(() => releasedV4SessionFormatCodec.decodeHeader(null)).toThrow('v4 physical')
    expect(() => releasedV4SessionFormatCodec.createDecoder({ ...header, version: 3 }, 'strict')).toThrow('v4 physical')
    expect(() => releasedV4SessionFormatCodec.decodeHeader({ type: 'session', ...header, extra: 1 })).toThrow(/field|member/)
  })

  it('retains predecessor and future delivery generations without activating their watermarks', () => {
    for (const version of [undefined, 0, 1, 2, 3, 5]) {
      const marker = { ...delivery(version, 'foreign'), data: { ...delivery(version).data as SessionFormatJsonObject, sessionId: 'foreign', throughSeq: 500 } }
      expect(restore([fact, marker]).events[1]).toBe(marker)
    }
    const current = delivery(4)
    expect(restore([fact, current]).events[1]).toBe(current)
    expect(() => restore([fact, delivery(4, 'foreign')])).toThrow('wrong Session')
  })

  it('rejects malformed active delivery coordinates and malformed generation identifiers', () => {
    const marker = delivery(4)
    const data = marker.data as SessionFormatJsonObject
    for (const throughSeq of [-1, 1, 1.5]) {
      expect(() => restore([fact, { ...marker, data: { ...data, throughSeq } }])).toThrow('throughSeq')
    }
    for (const sessionId of ['', null, 3]) {
      expect(() => restore([fact, { ...marker, data: { ...data, sessionId } }])).toThrow('nonempty')
    }
    for (const sessionFormatVersion of [-1, -0, 1.5, '4', null]) {
      expect(() => restore([fact, { ...marker, data: { ...data, sessionFormatVersion } }])).toThrow('sessionFormatVersion')
    }
    expect(() => restore([fact, { ...marker, data: null }])).toThrow('data must be an object')
    const reader = sessionFormatCatalog.createRestore({ type: 'session', ...header }, { recovery: 'strict', validation: 'current' })
    reader.decodeRow(fact)
    reader.decodeRow({ ...marker, data: { ...data, throughSeq: 1 } })
    expect(() => reader.finish()).toThrow('throughSeq')
  })

  it('preserves inherited and local events and admits foreign active deliveries inside the seed only', () => {
    const inherited = delivery(4, 'ancestor')
    const artifact = {
      header: { ...header, isSeeded: true, parentSession: 'ancestor' }, inheritedEventCount: 2,
      events: [fact, inherited, { type: 'session/end-seed', seq: 2, time: 3, data: { inherited: true } }, { ...fact, seq: 3 }],
    }
    expect(restoreReleasedV4Artifact(artifact, types)).toBe(artifact)
    expect(() => restoreReleasedV4Artifact({ ...artifact, inheritedEventCount: 1 }, types)).toThrow('marker')
  })

  it('preserves unknown ignorable values and requires installed vocabulary for unknown required events', () => {
    const opaque = { type: 'external/opaque', seq: 0, time: 1, data: { untouched: ['a', 3] }, ignorable: true }
    expect(restore([opaque]).events[0]).toBe(opaque)
    const required = { type: 'external/required', seq: 0, time: 1, data: null }
    expect(() => restore([required])).toThrow('unknown event type')
    const artifact = { header, events: [required], inheritedEventCount: 0 }
    expect(restoreReleasedV4Artifact(artifact, new Set([required.type]))).toBe(artifact)
  })

  it.each([
    { type: 'request/header', seq: 0, time: 1, data: { header: { system: '' } } },
    { type: 'system/message', seq: 0, time: 1, data: {} },
    { type: 'tool/code-dispatch', seq: 0, time: 1, data: null },
  ])('refuses structural $type violations even after recoverable corruption', (row) => {
    expect(() => { assertV4RowAdmission(row) }).toThrow()
    const decoder = releasedV4SessionFormatCodec.createDecoder({ type: 'session', ...header }, 'recoverable')
    const output = new SessionFormatEventCollector()
    decoder.decodeRow(null, output)
    expect(() => { decoder.decodeRow(row, output) }).toThrow()
  })

  it('leaves ordinary framing recovery to the released decoder', () => {
    expect(() => { assertV4RowAdmission(null) }).not.toThrow()
    expect(() => { assertV4RowAdmission(fact) }).not.toThrow()
    const decoder = releasedV4SessionFormatCodec.createDecoder({ type: 'session', ...header }, 'recoverable')
    const output = new SessionFormatEventCollector()
    decoder.decodeRow(fact, output)
    decoder.decodeRow(null, output)
    expect(decoder.finish(output)).toBe(0)
    expect(output.values).toEqual([fact])
  })
})
