import { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionFormatUnsupportedError, SessionPersistenceCorruptionError } from '@deepseek-ai/dsh-session-persistence'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { generationLogPath } from '../src/format.ts'
import { prepareCatalogFacts } from '../src/catalog-migration.ts'
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

  it('does not publish incomplete membership after a child header becomes unreadable', async () => {
    const f = await fixture()
    const path = await f.write('child', [], true)
    const broken = '{broken header\n'
    await writeFile(path, compression === 'none' ? broken : await compressZstdFrame(broken))
    await expect(f.read()).rejects.toThrow(path)
    await expect(f.ctx.sessionPersistence.open(f.parent, 'write')).rejects.toThrow(path)
    expect((await readdir(dirname(generationLogPath(f.root, undefined, f.parent, 3, compression)))).filter(name => name !== 'session.lock'))
      .toEqual([compression === 'none' ? 'session.v3.jsonl' : 'session.v3.jsonl.zstd'])
  })

  it('invalidates lightweight revisions on child membership and contents while retaining stable tokens', async () => {
    const f = await fixture()
    const revision = async () => (await f.ctx.sessionPersistence.stat(f.parent))!.revision
    const first = await revision()
    expect(await revision()).toBe(first)
    await f.write('child', [f.descriptor], true)
    const added = await revision()
    expect(added).not.toBe(first)
    expect((await f.ctx.sessionPersistence.list()).find(row => row.header.id === f.parent)?.revision).toBe(added)
    await f.write('child', [f.descriptor, { type: 'feedback/record', seq: 1, time: 3, data: {} }], true)
    expect(await revision()).not.toBe(added)
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

  it('invalidates historical revisions when selected children disappear or gain an opaque successor', async () => {
    const f = await fixture()
    const path = await f.write('child', [f.descriptor], true)
    const first = (await f.ctx.sessionPersistence.stat(f.parent))!.revision
    await rm(path)
    const removed = (await f.ctx.sessionPersistence.stat(f.parent))!.revision
    expect(removed).not.toBe(first)
    await f.write('child', [], true, 5)
    expect((await f.ctx.sessionPersistence.stat(f.parent))!.revision).not.toBe(removed)
    expect((await f.ctx.sessionPersistence.list()).find(row => row.header.id === f.parent)?.revision).not.toBe(removed)
  })

  it('reports a corrupt child body at the child location', async () => {
    const f = await fixture()
    const catalog = { type: 'subagent/catalog', seq: 0, time: 1,
      data: { version: 0, childId: 'grandchild', childCreatedAt: 3, mode: 'one-shot' } }
    const path = await f.write('child', [catalog, { ...catalog, seq: 1 }], true, 4)
    await expect(f.read()).rejects.toBeInstanceOf(SessionPersistenceCorruptionError)
    await expect(f.read()).rejects.toThrow(path)
  })

  it.each(['read', 'write'] as const)('locates physical child JSON corruption during %s access', async (access) => {
    const f = await fixture()
    const childPath = await f.write('child', [], true)
    const first = JSON.stringify({ ...f.header, id: 'child', origin: 'subagent', parentSession: f.parent, delegationDepth: 1 }) + '\n'
    // A sealed turn makes the malformed row corruption rather than a recoverable tail.
    const body = '{broken\n' + JSON.stringify({ type: 'turn/end', seq: 1, time: 2,
      data: { turn: 1, reason: { kind: 'completed' } } }) + '\n'
    await writeFile(childPath, compression === 'none' ? first + body
      : Buffer.concat([await compressZstdFrame(first), await compressZstdFrame(body)]))
    const parentPath = generationLogPath(f.root, undefined, f.parent, 3, compression)
    const original = await Promise.all([readFile(parentPath), readFile(childPath)])
    const error: unknown = await f.ctx.sessionPersistence.open(f.parent, access).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(SessionPersistenceCorruptionError)
    expect((error as Error).message).toContain(childPath)
    expect((error as Error).message).not.toContain(parentPath)
    expect((error as Error).message).toContain('row 1 is not valid JSON')
    expect(await Promise.all([readFile(parentPath), readFile(childPath)])).toEqual(original)
    expect((await readdir(dirname(parentPath))).filter(name => name !== 'session.lock'))
      .toEqual([compression === 'none' ? 'session.v3.jsonl' : 'session.v3.jsonl.zstd'])
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

  it.skipIf(compression !== 'zstd')('locates invalid compressed child frames at the child path', async () => {
    const f = await fixture()
    const childPath = await f.write('child', [], true)
    await writeFile(childPath, Buffer.concat([await readFile(childPath), Buffer.alloc(8)]))
    const error: unknown = await f.read().catch((error: unknown) => error)
    expect(error).toBeInstanceOf(SessionPersistenceCorruptionError)
    expect((error as Error).message).toContain(childPath)
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

  it.each([1, 2, 3])('backfills a missing catalog from descriptor v%i', async (version) => {
    const f = await fixture()
    const data = version === 1 ? { version, provider: 'spawn', label: 'old child' }
      : { ...f.descriptor.data, version }
    await f.write('child', [{ ...f.descriptor, data }], true)
    expect(await f.read()).toMatchObject([{ type: 'subagent/catalog', data: {
      childId: 'child', childCreatedAt: 2, mode: 'continuable', label: 'old child',
    } }])
    const writer = await f.ctx.sessionPersistence.open(f.parent, 'write')
    await writer.close()
  })

  it('classifies missing discovery information as unsupported migration', async () => {
    const f = await fixture()
    await f.write('child', [], true)
    await expect(f.read()).rejects.toBeInstanceOf(SessionFormatUnsupportedError)
    await expect(f.ctx.sessionPersistence.open(f.parent, 'write')).rejects.toBeInstanceOf(SessionFormatUnsupportedError)
    expect((await readdir(dirname(generationLogPath(f.root, undefined, f.parent, 3, compression)))).filter(name => name !== 'session.lock'))
      .toEqual([compression === 'none' ? 'session.v3.jsonl' : 'session.v3.jsonl.zstd'])
  })

  it.each([false, true])('refuses an opaque future generation before publishing membership (prepared=%s)', async (prepared) => {
    const f = await fixture()
    await f.write('child', [f.descriptor], true)
    if (prepared) expect(await f.read()).toHaveLength(1)
    await f.write('child', [], true, 5)
    await expect(f.ctx.sessionPersistence.open(f.parent, 'write')).rejects.toBeInstanceOf(SessionFormatUnsupportedError)
    expect((await readdir(dirname(generationLogPath(f.root, undefined, f.parent, 3, compression)))).filter(name => name !== 'session.lock'))
      .toEqual([compression === 'none' ? 'session.v3.jsonl' : 'session.v3.jsonl.zstd'])
  })

  it('requires a readable corpus even when an unknown header cannot identify its parent', async () => {
    const f = await fixture()
    await f.write('future-root', [], false, 5)
    expect((await f.ctx.sessionPersistence.list()).map(row => row.header.id)).toEqual([f.parent])
    await expect(f.read()).rejects.toBeInstanceOf(SessionFormatUnsupportedError)
  })

  it('preserves unsupported child decoding errors instead of reporting parent corruption', async () => {
    const f = await fixture()
    const path = await f.write('child', [{ type: 'future/required', seq: 0, time: 2, data: {} }], true)
    await expect(f.read()).rejects.toBeInstanceOf(SessionFormatUnsupportedError)
    await expect(f.read()).rejects.toThrow(path)
  })

  it('locates incomplete historical descriptor fields at their child source', async () => {
    const f = await fixture()
    const path = await f.write('child', [{ ...f.descriptor, data: { version: 2, provider: 'spawn', mode: 'unknown' } }], true)
    await expect(f.read()).rejects.toBeInstanceOf(SessionFormatUnsupportedError)
    await expect(f.read()).rejects.toThrow(path)
  })

  it.each(['read', 'write'] as const)('rejects duplicate own catalogs through a current %s open', async (access) => {
    const f = await fixture()
    const catalog = { type: 'subagent/catalog', seq: 0, time: 2,
      data: { version: 0, childId: 'child', childCreatedAt: 2, mode: 'one-shot' } }
    await f.write(f.parent, [catalog, { ...catalog, seq: 1 }], false, 4)
    await expect(f.ctx.sessionPersistence.open(f.parent, access)).rejects.toThrow('duplicate catalog child')
  })

  it('recollects a changed child within the same read open', async () => {
    const f = await fixture()
    await f.write('child', [f.descriptor], true)
    expect(await f.read()).toHaveLength(1)
    await f.write('child', [f.descriptor, { type: 'feedback/record', seq: 1, time: 3, data: { text: 'appended' } }], true)
    expect(await f.read()).toHaveLength(1)
    const writer = await f.ctx.sessionPersistence.open(f.parent, 'write')
    await writer.close()
  })

  it('detects children added after preparation instead of publishing incomplete membership', async () => {
    const f = await fixture()
    expect(await f.read()).toEqual([])
    await f.write('child', [f.descriptor], true)
    await expect(f.ctx.sessionPersistence.open(f.parent, 'write')).rejects.toThrow(generationLogPath(f.root, undefined, SessionId('child'), 3, compression))
    expect(await f.read()).toHaveLength(1)
    const writer = await f.ctx.sessionPersistence.open(f.parent, 'write')
    await writer.close()
  })

  it('refuses an unavailable descriptor without writing a successor', async () => {
    const f = await fixture()
    await f.write('child', [], true)
    await expect(f.read()).rejects.toThrow('supported subagent descriptor')
    const parentPath = generationLogPath(f.root, undefined, f.parent, 3, compression)
    expect(await readdir(dirname(parentPath))).toEqual([compression === 'none' ? 'session.v3.jsonl' : 'session.v3.jsonl.zstd'])
  })

  it('reads current children without recursive migration and preserves current parent fast reads', async () => {
    const f = await fixture()
    await f.write('child', [f.descriptor], true, 4)
    expect(await f.read()).toHaveLength(1)
    await f.write(f.parent, [], false, 4)
    await f.write('child', [], true, 4)
    expect(await f.read()).toEqual([])
  })

  it('refuses publication when a related child disappears', async () => {
    const f = await fixture()
    const path = await f.write('child', [f.descriptor], true)
    const header = { ...f.header, id: SessionId('child'), origin: 'subagent', parentSession: f.parent, createdAt: 2, delegationDepth: 1 } as SessionHeader
    const prepare = () => prepareCatalogFacts(f.parent, [{ path, header }], compression, new AbortController().signal)
    const prepared = await prepare()
    await rm(path)
    await expect(prepared.validate()).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(prepare()).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects changed header identities and invalid source selection', async () => {
    const f = await fixture()
    const path = await f.write('child', [f.descriptor], true)
    const header = { ...f.header, id: SessionId('wrong-child'), origin: 'subagent', parentSession: f.parent } as SessionHeader
    const signal = new AbortController().signal
    await expect(prepareCatalogFacts(f.parent, [{ path, header }], compression, signal)).rejects.toThrow('changed')
    await expect(prepareCatalogFacts(f.parent, [{ path: path + '.foreign', header }], compression, signal)).rejects.toThrow('unrecognized historical child generation')
    const controller = new AbortController()
    controller.abort(new Error('cancelled child collection'))
    await expect(prepareCatalogFacts(f.parent, [{ path, header }], compression, controller.signal)).rejects.toThrow('cancelled child collection')
  })

  it.each([0, 1, 2])('composes a V%i parent and child through all preceding edges', async (version) => {
    const f = await fixture()
    const initial = generationLogPath(f.root, undefined, f.parent, 3, compression)
    await rm(initial)
    const parentPath = await f.write(f.parent, [], false, version)
    const childPath = await f.write('child', [f.descriptor], true, version)
    const before = await Promise.all([readFile(parentPath), readFile(childPath)])
    expect(await f.read()).toMatchObject([{ type: 'subagent/catalog', seq: 0, data: { childId: 'child', mode: 'continuable', label: 'old child' } }])
    const writer = await f.ctx.sessionPersistence.open(f.parent, 'write')
    await writer.close()
    expect(await Promise.all([readFile(parentPath), readFile(childPath)])).toEqual(before)
    expect((await readdir(dirname(parentPath))).filter(name => name !== 'session.lock')).toHaveLength(2)
  })

  it('lists historical headers, prepares read-only membership, and publishes an unchanged-prefix successor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-catalog-migration-'))
    roots.push(root)
    const parent = SessionId('parent')
    const child = SessionId('child')
    const header = { type: 'session', version: 3, id: parent, createdAt: 1, isSeeded: false, delegationDepth: 0 }
    const childHeader = { ...header, id: child, createdAt: 2, origin: 'subagent', parentSession: parent, delegationDepth: 1 }
    const descriptor = { type: 'subagent/descriptor', seq: 0, time: 2, data: { version: 3, mode: 'one-shot', provider: 'spawn', label: 'old child' } }
    const sourcePaths: string[] = []
    for (const [meta, events] of [[header, []], [childHeader, [descriptor]]] as const) {
      const path = generationLogPath(root, undefined, meta.id, 3, compression)
      sourcePaths.push(path)
      await mkdir(dirname(path), { recursive: true })
      const first = Buffer.from(JSON.stringify(meta) + '\n')
      const body = Buffer.from(events.map(event => JSON.stringify(event) + '\n').join(''))
      await writeFile(path, compression === 'none' ? Buffer.concat([first, body])
        : Buffer.concat([await compressZstdFrame(first), ...(body.length === 0 ? [] : [await compressZstdFrame(body)])]))
    }
    const original = await Promise.all(sourcePaths.map(path => readFile(path)))
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(JsonlSessionPersistence, { root, compression })
    expect((await ctx.sessionPersistence.list()).map(row => row.header.id).sort()).toEqual([child, parent])
    const reader = await ctx.sessionPersistence.open(parent, 'read')
    let expected
    try {
      expect(reader.header.version).toBe(4)
      expected = (await reader.read()).events
      expect(expected).toEqual([{ type: 'subagent/catalog', seq: 0, time: 1, data: {
        version: 0, childId: child, childCreatedAt: 2, mode: 'one-shot', label: 'old child',
      } }])
      expect(await readdir(dirname(sourcePaths[0]!))).toEqual([compression === 'none' ? 'session.v3.jsonl' : 'session.v3.jsonl.zstd'])
    } finally { await reader.close() }
    const writer = await ctx.sessionPersistence.open(parent, 'write')
    try { expect((await writer.read()).events).toEqual(expected) } finally { await writer.close() }
    expect(await Promise.all(sourcePaths.map(path => readFile(path)))).toEqual(original)
    const reopened = await ctx.sessionPersistence.open(parent, 'read')
    try { expect((await reopened.read()).events).toEqual(expected) } finally { await reopened.close() }
  })
})
