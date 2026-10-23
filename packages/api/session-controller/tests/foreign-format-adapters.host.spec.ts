/**
 * Foreign session import for the two JSONL writers Alpha reads: Codex rollout
 * files and Claude Code project logs. Both carry one JSON object per line, so
 * these specs cover what each writer's records contribute to the converted
 * header and events, and what a writer leaves out.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sessionFormatCatalog } from '@mutantcat/dsh-session-format-catalog'
import type { SessionHeader } from '@mutantcat/dsh-session'
import type { ForeignSessionContent } from '../src/foreign-format-adapters.ts'
import { readForeignSession } from '../src/foreign-format-adapters.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** Write `lines` as one foreign JSONL session file and return its path. */
async function jsonlFile(
  format: 'codex' | 'claude',
  lines: readonly string[],
  name = 'session.jsonl',
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `foreign-${format}-`))
  roots.push(root)
  const path = join(root, name)
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8')
  return path
}

/** The converted events of one imported session, as plain records. */
function eventsOf(content: ForeignSessionContent): Record<string, unknown>[] {
  return content.events
}

/** The version an imported session header is expected to carry. */
function currentVersion(): SessionHeader['version'] {
  return sessionFormatCatalog.currentVersion as SessionHeader['version']
}

describe('codex session import', () => {
  it('converts session metadata and both message roles from a rollout file', async () => {
    const path = await jsonlFile('codex', [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-01-02T03:04:05.000Z',
        payload: { session_id: 'sess-codex', cwd: '/work/project' },
      }),
      JSON.stringify({ type: 'response_item', payload: { role: 'user', content: 'fix the build' } }),
      JSON.stringify({ type: 'response_item', payload: { role: 'assistant', content: [{ type: 'text', text: 'reading logs' }] } }),
      JSON.stringify({ type: 'response_item', payload: { role: 'system', content: 'ignored' } }),
      'not json',
    ])

    const content = await readForeignSession({ path, format: 'codex' })
    expect(content.header).toEqual({
      version: currentVersion(),
      id: 'sess-codex',
      createdAt: Date.parse('2026-01-02T03:04:05.000Z'),
      cwd: '/work/project',
      isSeeded: false,
      delegationDepth: 0,
    })
    expect(content.inheritedEventCount).toBe(0)
    expect(eventsOf(content)).toEqual([
      { type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: 'fix the build' }], source: { kind: 'user' }, id: 'imported-0' } }, surfaceOp: 'append' },
      { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'reading logs' }], source: { kind: 'assistant' }, id: 'imported-1' } }, surfaceOp: 'append' },
    ])
  })

  it('falls back to the rollout UUID, then to the file name, when no record carries an id', async () => {
    const uuid = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'
    const lines = [JSON.stringify({ type: 'response_item', payload: { role: 'user', content: 'hello' } })]

    const fromUuid = await readForeignSession({
      path: await jsonlFile('codex', lines, `rollout-2026-01-02T03-04-05-${uuid}.jsonl`),
      format: 'codex',
    })
    expect(fromUuid.header.id).toBe(uuid)

    const fromName = await readForeignSession({
      path: await jsonlFile('codex', lines, 'rollout-no-uuid.jsonl'),
      format: 'codex',
    })
    expect(fromName.header.id).toBe('rollout-no-uuid')
  })

  it('ignores metadata the writer typed as something other than a string', async () => {
    const path = await jsonlFile('codex', [
      JSON.stringify({ type: 'session_meta', payload: { session_id: 42, id: 'from-id', cwd: 7 } }),
      JSON.stringify({ type: 'response_item', payload: { role: 'user', content: 'hello' } }),
    ])

    const content = await readForeignSession({ path, format: 'codex' })
    expect(content.header.id).toBe('from-id')
    expect(content.header.cwd).toBeUndefined()
  })

  it('stops converting a session once the signal aborts part-way through', async () => {
    const path = await jsonlFile('codex', [
      JSON.stringify({ type: 'response_item', payload: { role: 'user', content: 'first' } }),
      JSON.stringify({ type: 'response_item', payload: { role: 'user', content: 'second' } }),
    ])
    // Tolerates the entry check and the first record, then aborts.
    let checks = 0
    const signal = {
      throwIfAborted: () => {
        if (checks++ >= 2) throw new Error('aborted')
      },
    } as unknown as AbortSignal

    await expect(readForeignSession({ path, format: 'codex' }, signal)).rejects.toThrow('aborted')
  })
})

describe('claude session import', () => {
  it('converts both roles and takes the header from the first record that carries one', async () => {
    const path = await jsonlFile('claude', [
      JSON.stringify({
        type: 'user',
        sessionId: 'sess-claude',
        timestamp: '2026-02-03T04:05:06.000Z',
        cwd: '/work/other',
        message: { role: 'user', content: 'first' },
      }),
      JSON.stringify({
        type: 'assistant',
        sessionId: 'later-id',
        cwd: '/work/changed',
        message: { role: 'assistant', content: [{ type: 'text', text: 'second' }, { type: 'tool_use', name: 'Bash' }] },
      }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: '' } }),
    ])

    const content = await readForeignSession({ path, format: 'claude' })
    expect(content.header).toEqual({
      version: currentVersion(),
      id: 'sess-claude',
      createdAt: Date.parse('2026-02-03T04:05:06.000Z'),
      cwd: '/work/other',
      isSeeded: false,
      delegationDepth: 0,
    })
    expect(eventsOf(content)).toEqual([
      { type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: 'first' }], source: { kind: 'user' }, id: 'imported-0' } }, surfaceOp: 'append' },
      { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'second' }], source: { kind: 'assistant' }, id: 'imported-1' } }, surfaceOp: 'append' },
    ])
  })

  it('falls back to the file name and skips records without a message', async () => {
    const path = await jsonlFile('claude', [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }),
      JSON.stringify({ type: 'assistant' }),
      JSON.stringify({ type: 'summary', message: { role: 'user', content: 'ignored' } }),
    ], 'claude-session.jsonl')

    const content = await readForeignSession({ path, format: 'claude' })
    expect(content.header.id).toBe('claude-session')
    expect(content.header.cwd).toBeUndefined()
    expect(eventsOf(content)).toHaveLength(1)
  })
})
