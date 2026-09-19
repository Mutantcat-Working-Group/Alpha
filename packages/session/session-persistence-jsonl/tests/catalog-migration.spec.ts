import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SessionFormatUnsupportedError, SessionPersistenceCorruptionError } from '@deepseek-ai/dsh-session-persistence'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { generationLogPath } from '../src/format.ts'
import { compressZstdFrame } from '../src/zstd.ts'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe.each(['none', 'zstd'] as const)('historical catalog publication (%s)', (compression) => {
  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'dsh-catalog-migration-'))
    roots.push(root)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(JsonlSessionPersistence, { root, compression })
    const parent = SessionId('parent')
    const header = { type: 'session', version: 3, id: parent, createdAt: 1, isSeeded: false, delegationDepth: 0 }
    async function write(id: string, events: unknown[], child = false, version = 3) {
      const path = generationLogPath(root, undefined, SessionId(id), version, compression)
      await mkdir(dirname(path), { recursive: true })
      const meta: Record<string, unknown> = { ...header, id, version, ...(child ? { origin: 'subagent', parentSession: parent, createdAt: 2, delegationDepth: 1 } : {}) }
      if (version < 2) delete meta['isSeeded']
      const first = JSON.stringify(meta) + '\n'
      const body = events.map(row => JSON.stringify(row) + '\n').join('')
      await writeFile(path, compression === 'none' ? first + body
        : Buffer.concat([await compressZstdFrame(first), ...(body.length === 0 ? [] : [await compressZstdFrame(body)])]))
      return path
    }
    await write(parent, [])
    const descriptor = { type: 'subagent/descriptor', seq: 0, time: 2, data: { version: 3, mode: 'continuable', provider: 'spawn', label: 'old child' } }
    async function read() {
      const handle = await ctx.sessionPersistence.open(parent, 'read')
      try { return (await handle.read()).events } finally { await handle.close() }
    }
    return { root, ctx, parent, header, descriptor, write, read }
  }

  it.each(['read', 'write'] as const)('refuses foreign native V4 delivery through %s access', async (access) => {
    const f = await fixture()
    await f.write(f.parent, [
      { type: 'feedback/record', seq: 0, time: 1, data: {} },
      { type: 'session-log-deepseek/delivery-accepted', seq: 1, time: 2,
        data: { sessionId: 'other', sessionFormatVersion: 4, throughSeq: 0 } },
    ], false, 4)
    await expect(f.ctx.sessionPersistence.open(f.parent, access)).rejects.toThrow('wrong Session')
  })

  it('reports malformed native catalog data without migration terminology', async () => {
    const f = await fixture()
    await f.write(f.parent, [{ type: 'subagent/catalog', seq: 0, time: 1,
      data: { version: 0, childId: 'child', childCreatedAt: 2, mode: 'invalid' } }], false, 4)
    const error = await f.read().catch((error: unknown) => error)
    expect(error).toBeInstanceOf(SessionPersistenceCorruptionError)
    expect((error as Error).message).not.toContain('migration requires')
  })

  it('keeps current revisions independent of unrelated historical logs and write ownership', async () => {
    const f = await fixture()
    await f.write(f.parent, [], false, 4)
    const first = (await f.ctx.sessionPersistence.stat(f.parent))!.revision
    await f.write('child', [f.descriptor], true)
    expect((await f.ctx.sessionPersistence.stat(f.parent))!.revision).toBe(first)
    expect((await f.ctx.sessionPersistence.list()).find(row => row.header.id === f.parent)?.revision).toBe(first)
    const writer = await f.ctx.sessionPersistence.open(f.parent, 'write')
    await writer.close()
    expect((await f.ctx.sessionPersistence.stat(f.parent))!.revision).toBe(first)
  })

  it('preserves opaque inherited catalogs through read preparation and write publication', async () => {
    const f = await fixture()
    const parentPath = generationLogPath(f.root, undefined, f.parent, 3, compression)
    const first = JSON.stringify({ ...f.header, isSeeded: true, parentSession: 'ancestor' }) + '\n'
    const events = [
      { type: 'subagent/catalog', seq: 0, time: 1, data: { version: 99 } },
      { type: 'session/end-seed', seq: 1, time: 2, data: { inherited: true } },
      { type: 'subagent/catalog', seq: 2, time: 3, data: null },
      { type: 'session/end-seed', seq: 3, time: 4, data: { inherited: true } },
    ]
    const body = events.map(event => JSON.stringify(event) + '\n').join('')
    await writeFile(parentPath, compression === 'none' ? first + body
      : Buffer.concat([await compressZstdFrame(first), await compressZstdFrame(body)]))
    const original = await readFile(parentPath)
    expect(await f.read()).toEqual(events)
    const writer = await f.ctx.sessionPersistence.open(f.parent, 'write')
    try { expect((await writer.read()).events).toEqual(events) } finally { await writer.close() }
    expect(await f.read()).toEqual(events)
    expect(await readFile(parentPath)).toEqual(original)
  })

  it('keeps a complete parent catalog when a published child never writes a descriptor', async () => {
    const f = await fixture()
    const catalog = { type: 'subagent/catalog', seq: 0, time: 2,
      data: { version: 0, childId: 'child', childCreatedAt: 2, mode: 'one-shot', label: 'failed startup' } }
    const parentPath = await f.write(f.parent, [catalog])
    const childPath = await f.write('child', [], true)
    const original = await Promise.all([readFile(parentPath), readFile(childPath)])
    expect(await f.read()).toEqual([catalog])
    const writer = await f.ctx.sessionPersistence.open(f.parent, 'write')
    await writer.close()
    expect(await f.read()).toEqual([catalog])
    expect(await Promise.all([readFile(parentPath), readFile(childPath)])).toEqual(original)
  })

  it.each(['missing', 'unknown', 'multiple'] as const)('publishes the parent without invented %s child discovery information', async (kind) => {
    const f = await fixture()
    const events = kind === 'missing' ? [] : kind === 'unknown'
      ? [{ ...f.descriptor, data: { version: 99, extension: { retained: true } } }]
      : [f.descriptor, { ...f.descriptor, seq: 1, data: { ...f.descriptor.data, label: 'second descriptor' } }]
    const childPath = await f.write('child', events, true)
    const parentPath = generationLogPath(f.root, undefined, f.parent, 3, compression)
    const original = await Promise.all([readFile(parentPath), readFile(childPath)])
    expect(await f.read()).toEqual([])
    const writer = await f.ctx.sessionPersistence.open(f.parent, 'write')
    try { expect((await writer.read()).events).toEqual([]) } finally { await writer.close() }
    expect(await f.read()).toEqual([])
    const child = await f.ctx.sessionPersistence.open(SessionId('child'), 'read')
    try { expect((await child.read()).events).toEqual(events) } finally { await child.close() }
    expect(await Promise.all([readFile(parentPath), readFile(childPath)])).toEqual(original)
    expect((await readdir(dirname(parentPath))).filter(name => name !== 'session.lock').sort())
      .toEqual(compression === 'none' ? ['session.v3.jsonl', 'session.v4.jsonl'] : ['session.v3.jsonl.zstd', 'session.v4.jsonl.zstd'])
  })

  it.each(['read', 'write'] as const)('rejects duplicate own catalogs through a current %s open', async (access) => {
    const f = await fixture()
    const catalog = { type: 'subagent/catalog', seq: 0, time: 2,
      data: { version: 0, childId: 'child', childCreatedAt: 2, mode: 'one-shot' } }
    await f.write(f.parent, [catalog, { ...catalog, seq: 1 }], false, 4)
    await expect(f.ctx.sessionPersistence.open(f.parent, access)).rejects.toThrow('duplicate catalog child')
  })

  it.each(['read', 'write'] as const)('isolates malformed child JSON until explicit %s access', async (access) => {
    const f = await fixture()
    const childPath = await f.write('child', [], true)
    const first = JSON.stringify({ ...f.header, id: 'child', origin: 'subagent', parentSession: f.parent, delegationDepth: 1 }) + '\n'
    const body = '{broken\n' + JSON.stringify({ type: 'turn/end', seq: 1, time: 2,
      data: { turn: 1, reason: { kind: 'completed' } } }) + '\n'
    await writeFile(childPath, compression === 'none' ? first + body
      : Buffer.concat([await compressZstdFrame(first), await compressZstdFrame(body)]))
    const original = await readFile(childPath)
    const parent = await f.ctx.sessionPersistence.open(f.parent, access)
    try { expect((await parent.read()).events).toEqual([]) } finally { await parent.close() }
    await expect(f.ctx.sessionPersistence.open(SessionId('child'), access)).rejects.toBeInstanceOf(SessionPersistenceCorruptionError)
    expect(await readFile(childPath)).toEqual(original)
    expect((await readdir(dirname(childPath))).filter(name => name !== 'session.lock'))
      .toEqual([compression === 'none' ? 'session.v3.jsonl' : 'session.v3.jsonl.zstd'])
    expect(await f.read()).toEqual([])
  })

  it.each([true, false])('opens the parent independently of unsupported related=%s generations', async (related) => {
    const f = await fixture()
    await f.write('future', [], related, 5)
    expect(await f.read()).toEqual([])
    const parent = await f.ctx.sessionPersistence.open(f.parent, 'write')
    await parent.close()
    await expect(f.ctx.sessionPersistence.open(SessionId('future'), 'read')).rejects.toBeInstanceOf(SessionFormatUnsupportedError)
  })

  it('keeps unreadable child headers outside parent migration', async () => {
    const f = await fixture()
    const path = await f.write('child', [], true)
    await writeFile(path, compression === 'none' ? '{broken\n' : await compressZstdFrame('{broken\n'))
    expect(await f.read()).toEqual([])
    const writer = await f.ctx.sessionPersistence.open(f.parent, 'write')
    await writer.close()
  })

  it('keeps revisions and prepared parent history independent of child membership and contents', async () => {
    const f = await fixture()
    const first = (await f.ctx.sessionPersistence.stat(f.parent))!.revision
    expect(await f.read()).toEqual([])
    const path = await f.write('child', [f.descriptor], true)
    expect((await f.ctx.sessionPersistence.stat(f.parent))!.revision).toBe(first)
    await f.write('child', [{ ...f.descriptor, data: { ...f.descriptor.data, label: 'changed' } }], true)
    expect((await f.ctx.sessionPersistence.list()).find(row => row.header.id === f.parent)?.revision).toBe(first)
    await rm(path)
    expect((await f.ctx.sessionPersistence.stat(f.parent))!.revision).toBe(first)
    const writer = await f.ctx.sessionPersistence.open(f.parent, 'write')
    try { expect((await writer.read()).events).toEqual([]) } finally { await writer.close() }
  })

  it.each([0, 1, 2, 3])('migrates a V%i child only on its own write open and preserves predecessors', async (version) => {
    const f = await fixture()
    await rm(generationLogPath(f.root, undefined, f.parent, 3, compression))
    const parentPath = await f.write(f.parent, [], false, version)
    const childPath = await f.write('child', [f.descriptor], true, version)
    const original = await Promise.all([readFile(parentPath), readFile(childPath)])
    expect(await f.read()).toEqual([])
    const writer = await f.ctx.sessionPersistence.open(f.parent, 'write')
    await writer.close()
    const childSuccessor = generationLogPath(f.root, undefined, SessionId('child'), 4, compression)
    await expect(readFile(childSuccessor)).rejects.toMatchObject({ code: 'ENOENT' })
    const childReader = await f.ctx.sessionPersistence.open(SessionId('child'), 'read')
    try { expect((await childReader.read()).events).toEqual([f.descriptor]) } finally { await childReader.close() }
    await expect(readFile(childSuccessor)).rejects.toMatchObject({ code: 'ENOENT' })
    const childWriter = await f.ctx.sessionPersistence.open(SessionId('child'), 'write')
    await childWriter.close()
    expect((await readFile(childSuccessor)).length).toBeGreaterThan(0)
    expect(await Promise.all([readFile(parentPath), readFile(childPath)])).toEqual(original)
  })
})
