import { describe, expect, it } from 'vitest'
import type { SessionFormatEvent, SessionFormatJsonObject, SessionFormatJsonValue } from '@deepseek-ai/dsh-session-format'
import { mapEventMessages, rewritePluginSource } from '../src/sources.ts'

function event(type: string, data: SessionFormatJsonObject): SessionFormatEvent {
  return { type, seq: 0, time: 1, data }
}

const identity = (message: SessionFormatJsonObject): SessionFormatJsonObject => message

describe('mapEventMessages', () => {
  it('returns events whose data is not an object', () => {
    const row = { type: 'turn/start', seq: 0, time: 1, data: 'nope' } as unknown as SessionFormatEvent
    expect(mapEventMessages(row, identity)).toBe(row)
  })

  it('transforms the user/message payload and preserves identity when unchanged', () => {
    const message: SessionFormatJsonObject = { id: 'u', role: 'user', source: { kind: 'user' }, content: [] }
    const row = event('user/message', message)
    expect(mapEventMessages(row, identity)).toBe(row)
    expect(mapEventMessages(row, value => ({ ...value, id: 'u2' })).data).toEqual({ ...message, id: 'u2' })
  })

  it('transforms the message payload of system, assistant, and tool/result rows', () => {
    const message: SessionFormatJsonObject = { id: 's', role: 'system', source: { kind: 'system-prompt' }, content: [] }
    const row = event('system/message', { turn: 1, step: 1, message })
    expect(mapEventMessages(row, identity)).toBe(row)
    expect((mapEventMessages(row, value => ({ ...value, id: 's2' })).data as SessionFormatJsonObject)['message']).toEqual({ ...message, id: 's2' })
  })

  it('refuses a message payload that is not an object', () => {
    expect(() => mapEventMessages(event('system/message', { message: 'nope' }), identity)).toThrow(/requires a message/)
  })

  it('transforms message arrays on spliced and title-request rows', () => {
    const message: SessionFormatJsonObject = { id: 'u', role: 'user', source: { kind: 'user' }, content: [] }
    const spliced = event('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message] })
    expect(mapEventMessages(spliced, identity)).toBe(spliced)
    expect((mapEventMessages(spliced, value => ({ ...value, id: 'u2' })).data as SessionFormatJsonObject)['inserted']).toEqual([{ ...message, id: 'u2' }])
    const title = event('session/title-llm-request', { messages: [message] })
    expect(mapEventMessages(title, identity)).toBe(title)
    expect((mapEventMessages(title, value => ({ ...value, id: 'u2' })).data as SessionFormatJsonObject)['messages']).toEqual([{ ...message, id: 'u2' }])
  })

  it('refuses a message array that is not an array and members that are not objects', () => {
    expect(() => mapEventMessages(event('agent/inbox/spliced', { inserted: 'nope' }), identity)).toThrow(/requires message array/)
    expect(() => mapEventMessages(event('agent/inbox/spliced', { inserted: ['nope'] }), identity)).toThrow(/requires message objects/)
  })

  it('returns unrelated events unchanged', () => {
    const row = event('turn/start', { turn: 1 })
    expect(mapEventMessages(row, identity)).toBe(row)
  })
})

describe('rewritePluginSource', () => {
  it('rewrites renamed and role-sensitive producers, dropping the plugin field', () => {
    expect(rewritePluginSource({ kind: 'plugin', plugin: 'tools-ptc' }, 1, 'user')).toEqual({ kind: 'ptc-mode' })
    expect(rewritePluginSource({ kind: 'plugin', plugin: 'tools-code-mode' }, 1, 'user')).toEqual({ kind: 'ptc-mode' })
    expect(rewritePluginSource({ kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' }, 1, 'system')).toEqual({ kind: 'system-prompt' })
    expect(rewritePluginSource({ kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' }, 1, 'user')).toEqual({ kind: 'runtime-context' })
    expect(rewritePluginSource({ kind: 'plugin', plugin: 'external', extra: true }, 1, 'user')).toEqual({ kind: 'external', extra: true })
  })

  it('refuses a plugin field that is not a non-empty string', () => {
    const plugins: readonly SessionFormatJsonValue[] = [null, '', 7]
    for (const plugin of plugins) {
      expect(() => rewritePluginSource({ kind: 'plugin', plugin }, 3, 'user')).toThrow(/not canonical/)
    }
  })

  it('refuses external plugin names that collide with current producer kinds', () => {
    for (const plugin of ['plugin', 'user', 'model', 'tool', 'system-prompt', 'runtime-context', 'compact-checkpoint', 'ptc-mode', 'compact-basic', 'auto-review']) {
      expect(() => rewritePluginSource({ kind: 'plugin', plugin }, 3, 'user')).toThrow(/collides with a current producer kind/)
    }
    expect(rewritePluginSource({ kind: 'plugin', plugin: 'agent-instructions', form: 'instructions', changes: [] }, 3, 'user'))
      .toEqual({ kind: 'agent-instructions', form: 'instructions', changes: [] })
    expect(rewritePluginSource({ kind: 'plugin', plugin: 'tool-jobs' }, 3, 'user')).toEqual({ kind: 'tool-jobs' })
    expect(rewritePluginSource({ kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' }, 3, 'system')).toEqual({ kind: 'system-prompt' })
  })
})
