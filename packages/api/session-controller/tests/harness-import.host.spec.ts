/**
 * Explicit official-Harness chat-history import: discovery, copy, idempotence,
 * older-generation migration, and per-Session refusal isolation. The source
 * root is produced by the real JSONL backend (so the fixtures carry the
 * physical framing the official Harness writes) and is never written by the
 * import.
 */

import { Context } from '@mutantcat/cordis'
import { SESSION_FORMAT_VERSION, SessionId, type SessionEvent, type SessionHeader } from '@mutantcat/dsh-session'
import { createSessionFormatCatalogWithChildren } from '@mutantcat/dsh-session-format-catalog'
import JsonlSessionPersistence, { type JsonlCompression } from '@mutantcat/dsh-session-persistence-jsonl'
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import {
  HarnessSessionImport,
  configuredHarnessSessionsRoot,
  defaultHarnessSessionsRoot,
} from '../src/import-harness-sessions.ts'
import { createSessionTestRemote } from './test-remote.ts'

const CWD = '/work/project'

/** One raw current-format event row, before the catalog stamps its envelope. */
interface RawRow {
  readonly type: string
  readonly surfaceOp?: unknown
  readonly data: unknown
}

/** A minimal complete turn the current format accepts. */
const TURN: readonly RawRow[] = [
  { type: 'turn/start', data: { turn: 1 } },
  { type: 'step/start', data: { turn: 1, step: 1 } },
  { type: 'user/message', surfaceOp: 'append', data: {
    id: 'ask', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Import me.' }],
  } },
  { type: 'request/header', data: { header: { config: { provider: 'mock', model: 'mock' } }, reason: 'initial' } },
  { type: 'step/end', data: { turn: 1, step: 1 } },
  { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
]

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  try {
    for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  } finally {
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  }
})

/** One temporary root this spec owns and removes. */
async function directory(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

/** Mount the production JSONL backend on one root. */
async function mount(root: string, compression: JsonlCompression = 'zstd'): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root, compression })
  return ctx
}

/**
 * The production backend with one hook at Session creation, so a spec can
 * cancel an import exactly at its per-Session commit point.
 */
class CancellingCreatePersistence extends JsonlSessionPersistence {
  /** Fired inside `create`, before the adopted Session is materialized. */
  beforeCreate: (() => void) | undefined

  override async create(
    header: SessionHeader,
    options?: Parameters<JsonlSessionPersistence['create']>[1],
  ): ReturnType<JsonlSessionPersistence['create']> {
    this.beforeCreate?.()
    return super.create(header, options)
  }
}

/** Decode raw rows into stored current-format events through the format catalog. */
function currentEvents(id: string, rows: readonly RawRow[]): SessionEvent[] {
  const restore = createSessionFormatCatalogWithChildren([]).createRestore(
    { type: 'session', version: SESSION_FORMAT_VERSION, id, createdAt: 1000, isSeeded: false, delegationDepth: 0 },
    { recovery: 'strict', validation: 'current' },
  )
  rows.forEach((row, seq) => { restore.decodeRow({ ...row, seq, time: 1001 + seq }) })
  return restore.finish().events as unknown as SessionEvent[]
}

/** Header the production backend writes for a top-level Session. */
function headerOf(id: string, cwd: string): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 1000, cwd,
    isSeeded: false, delegationDepth: 0,
  }
}

/** Publish one current-format Session into a root through the production writer. */
async function seed(root: string, id: string, cwd: string): Promise<void> {
  const ctx = await mount(root)
  const handle = await ctx.sessionPersistence.create(headerOf(id, cwd), {})
  try {
    await handle.append(currentEvents(id, TURN))
    await handle.flush()
  } finally {
    await handle.close()
  }
}

/** The one Session directory of a Session this spec just seeded. */
async function sessionDirectory(root: string, id: string): Promise<string> {
  const found: string[] = []
  for (const project of await readdir(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue
    const projectPath = join(root, project.name)
    for (const session of await readdir(projectPath, { withFileTypes: true })) {
      if (session.isDirectory() && session.name === id) found.push(join(projectPath, session.name))
    }
  }
  expect(found).toHaveLength(1)
  return found[0]!
}

/** Replace a seeded Session with a hand-written generation of the same identity. */
async function replaceGeneration(
  root: string,
  id: string,
  filename: string,
  header: Record<string, unknown>,
  rows: readonly unknown[],
): Promise<string> {
  const directoryPath = await sessionDirectory(root, id)
  for (const entry of await readdir(directoryPath)) {
    if (entry.startsWith('session.v')) await rm(join(directoryPath, entry), { force: true })
  }
  const path = join(directoryPath, filename)
  await writeFile(path, [JSON.stringify(header), ...rows.map(row => JSON.stringify(row))].join('\n') + '\n')
  return path
}

/** Content digest of every file under one root, keyed by relative path. */
async function fingerprint(root: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {}
  async function walk(directoryPath: string): Promise<void> {
    const entries = (await readdir(directoryPath, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const path = join(directoryPath, entry.name)
      if (entry.isDirectory()) await walk(path)
      else snapshot[path.slice(root.length + 1)] = createHash('sha256').update(await readFile(path)).digest('hex')
    }
  }
  await walk(root)
  return snapshot
}

/** Read one Session back through a mounted backend, or undefined when absent. */
async function readStored(ctx: Context, id: string) {
  if (await ctx.sessionPersistence.stat(SessionId(id)) === undefined) return undefined
  const handle = await ctx.sessionPersistence.open(SessionId(id), 'read')
  try {
    const restored = await handle.read()
    return { header: handle.header, events: restored.events }
  } finally {
    await handle.close()
  }
}

/** One source root plus the operation that imports it into a fresh target root. */
async function bench(): Promise<{
  source: string
  target: Context
  targetRoot: string
  operation: HarnessSessionImport
}> {
  const source = await directory('dsh-explore-import-source-')
  const targetRoot = await directory('dsh-explore-import-target-')
  const target = await mount(targetRoot)
  return { source, target, targetRoot, operation: new HarnessSessionImport(target, source) }
}

describe('Harness import gateway', () => {
  it('reports the configured source root and installed sources, and imports an explicit root on request', async () => {
    const targetRoot = await directory('dsh-explore-import-gateway-')
    const target = await mount(targetRoot)
    const remote = createSessionTestRemote(target, {
      defaultModelSelection: () => ({ provider: 'mock', model: 'mock' }),
      cwd: CWD,
    })

    const configured = await remote.harnessSessionsRoot()
    expect(configured.ok).toBe(true)
    if (!configured.ok) throw new Error('expected a configured source root')
    expect(configured.value.sourceRoot).toBe(configuredHarnessSessionsRoot())

    // Which Agents the picker offers depends on the Host machine, so only each
    // entry's shape is checked here; the catalog itself is pinned by
    // agent-session-sources.host.spec.ts.
    const installed = await remote.harnessSessionSources()
    expect(installed.ok).toBe(true)
    if (!installed.ok) throw new Error('expected an installed-source list')
    expect(installed.value.sources.every(source => source.sourceRoot.length > 0)).toBe(true)

    const missing = join(targetRoot, 'absent-source')
    const imported = await remote.importHarnessSessions({ sourceRoot: missing })
    expect(imported.ok).toBe(true)
    if (!imported.ok) throw new Error('expected a successful import')
    expect(imported.value).toEqual({ sourceRoot: missing, results: [] })
  })
})

describe('HarnessSessionImport', () => {
  it('imports every discovered Session, copies its events, and leaves the source untouched', async () => {
    const b = await bench()
    await seed(b.source, 'first', CWD)
    await seed(b.source, 'second', '/work/other')
    const before = await fingerprint(b.source)

    const value = await b.operation.run({}, new AbortController().signal)

    expect(value.sourceRoot).toBe(b.source)
    // Discovery order follows the sorted project directories, not insertion order.
    expect(value.results.map(result => ({ id: String(result.sessionId), status: result.status })).sort(
      (left, right) => left.id.localeCompare(right.id),
    )).toEqual([{ id: 'first', status: 'imported' }, { id: 'second', status: 'imported' }])
    const stored = await readStored(b.target, 'first')
    expect(stored?.header.version).toBe(SESSION_FORMAT_VERSION)
    expect(stored?.header.cwd).toBe(CWD)
    expect(stored?.events.map(event => event.type)).toEqual(TURN.map(row => row.type))
    expect(await fingerprint(b.source)).toEqual(before)
  })

  it('reports a second run as already present and writes nothing new', async () => {
    const b = await bench()
    await seed(b.source, 'repeat', CWD)

    const first = await b.operation.run({}, new AbortController().signal)
    const sourceAfter = await fingerprint(b.source)
    const targetAfter = await fingerprint(b.targetRoot)
    const second = await b.operation.run({}, new AbortController().signal)

    expect(first.results).toMatchObject([{ sessionId: 'repeat', status: 'imported' }])
    expect(second.results).toMatchObject([{ sessionId: 'repeat', status: 'already-present' }])
    expect(await fingerprint(b.source)).toEqual(sourceAfter)
    expect(await fingerprint(b.targetRoot)).toEqual(targetAfter)
    expect(await readStored(b.target, 'repeat')).toBeDefined()
  })

  it('reports a create race as already present and a hostile rejection as a refusal', async () => {
    const b = await bench()
    await seed(b.source, 'raced', CWD)
    await seed(b.source, 'hostile', CWD)
    const persistence = b.target.sessionPersistence
    const create = persistence.create.bind(persistence)
    persistence.create = (async (header, options) => {
      if (header.id === SessionId('raced')) {
        throw Object.assign(new Error('already there'), { name: 'SessionAlreadyExistsError' })
      }
      if (header.id === SessionId('hostile')) throw 'gateway offline'
      return create(header, options)
    })

    const value = await b.operation.run({}, new AbortController().signal)

    const bySession = new Map(value.results.map(result => [String(result.sessionId), result]))
    expect(bySession.get('raced')).toMatchObject({ status: 'already-present' })
    expect(bySession.get('hostile')).toMatchObject({ status: 'refused', reason: 'gateway offline' })
  })

  it('publishes an older generation as a current-format successor without rewriting the source', async () => {
    const b = await bench()
    await seed(b.source, 'historical', CWD)
    const historical = await replaceGeneration(b.source, 'historical', 'session.v3.jsonl', {
      type: 'session', version: 3, id: 'historical', createdAt: 1000, cwd: CWD,
      isSeeded: false, delegationDepth: 0,
    }, [])
    const before = await fingerprint(b.source)

    const value = await b.operation.run({}, new AbortController().signal)

    expect(value.results).toMatchObject([{ sessionId: 'historical', status: 'imported' }])
    const stored = await readStored(b.target, 'historical')
    expect(stored?.header.version).toBe(SESSION_FORMAT_VERSION)
    expect(stored?.events).toEqual([])
    expect(await fingerprint(b.source)).toEqual(before)
    expect(await readdir(await sessionDirectory(b.source, 'historical'))).toContain('session.v3.jsonl')
    expect(await readFile(historical, 'utf8')).toContain('"version":3')
  })

  it('refuses a corrupt Session on its own and still imports its siblings', async () => {
    const b = await bench()
    await seed(b.source, 'good', CWD)
    await seed(b.source, 'broken', CWD)
    await replaceGeneration(b.source, 'broken', 'session.v4.jsonl', {
      type: 'session', version: SESSION_FORMAT_VERSION, id: 'broken', createdAt: 1000, cwd: CWD,
      isSeeded: false, delegationDepth: 0,
    }, [{ type: 'harness/unknown-row', seq: 0, time: 1, data: {} }])
    const before = await fingerprint(b.source)

    const value = await b.operation.run({}, new AbortController().signal)

    const bySession = new Map(value.results.map(result => [String(result.sessionId), result]))
    expect(bySession.get('good')).toMatchObject({ status: 'imported' })
    expect(bySession.get('broken')).toMatchObject({ status: 'refused' })
    expect(bySession.get('broken')?.reason).toMatch(/unknown-row/)
    expect(await readStored(b.target, 'good')).toBeDefined()
    expect(await readStored(b.target, 'broken')).toBeUndefined()
    expect(await fingerprint(b.source)).toEqual(before)
  })

  it('refuses a Session whose header cannot be read and keeps scanning the rest', async () => {
    const b = await bench()
    await seed(b.source, 'healthy', CWD)
    await mkdir(join(b.source, '--work-broken--', 'unreadable'), { recursive: true })
    await writeFile(join(b.source, '--work-broken--', 'unreadable', 'session.v4.jsonl'), '{not json\n')

    const value = await b.operation.run({}, new AbortController().signal)

    expect([...value.results].sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)))
      .toMatchObject([{ status: 'refused' }, { sessionId: 'healthy', status: 'imported' }])
    expect(await readStored(b.target, 'healthy')).toBeDefined()
  })

  it('treats an absent source root as no Sessions', async () => {
    const b = await bench()
    const missing = new HarnessSessionImport(b.target, join(b.source, 'missing'))

    await expect(missing.run({}, new AbortController().signal)).resolves.toMatchObject({ results: [] })
  })

  it('resolves an override against the configured default and never defaults internally', async () => {
    const configured = configuredHarnessSessionsRoot('/configured/sessions')
    const operation = new HarnessSessionImport(new Context(), configured)

    expect(defaultHarnessSessionsRoot()).toBe(join(homedir(), '.dsh', 'sessions'))
    expect(operation.sourceRoot).toBe(configured)
    expect(operation.resolve({})).toBe(configured)
    expect(operation.resolve({ sourceRoot: '   ' })).toBe(configured)
    expect(operation.resolve({ sourceRoot: '/elsewhere/sessions' })).toBe('/elsewhere/sessions')
    expect(operation.resolve({ sourceRoot: '~' })).not.toBe('~')
    expect(operation.resolve({ sourceRoot: 'relative/sessions' })).toBe(join(process.cwd(), 'relative/sessions'))
    expect(configuredHarnessSessionsRoot('')).toBe(defaultHarnessSessionsRoot())
    expect(configuredHarnessSessionsRoot('~/dsh-sessions')).toBe(join(homedir(), 'dsh-sessions'))
  })

  it('completes an adopted Session that the caller cancels at its commit point', async () => {
    const source = await directory('dsh-explore-import-source-')
    const targetRoot = await directory('dsh-explore-import-target-')
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(CancellingCreatePersistence, { root: targetRoot, compression: 'zstd' })
    const persistence = ctx.sessionPersistence as CancellingCreatePersistence
    await seed(source, 'atomic', CWD)
    const controller = new AbortController()
    persistence.beforeCreate = () => { controller.abort() }
    const operation = new HarnessSessionImport(ctx, source)

    const value = await operation.run({}, controller.signal)

    // One adopted Session is one commit: the abort lands before the write, so
    // the copy is whole instead of a torn log that a later run would report as
    // already present.
    expect(value.results).toMatchObject([{ sessionId: 'atomic', status: 'imported' }])
    const stored = await readStored(ctx, 'atomic')
    expect(stored?.events.map(event => event.type)).toEqual(TURN.map(row => row.type))
  })

  it('refuses to run without a mounted persistence backend', async () => {
    const source = await directory('dsh-explore-import-source-')
    await seed(source, 'orphan', CWD)
    const operation = new HarnessSessionImport(new Context(), source)

    await expect(operation.run({}, new AbortController().signal))
      .rejects.toThrow(/needs a mounted session-persistence backend/)
  })
})
