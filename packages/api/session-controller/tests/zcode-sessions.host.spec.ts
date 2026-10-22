/**
 * ZCode (Z.ai) session import: detection, discovery, and conversion of both the
 * current SQLite store and the legacy per-task JSON snapshots. Fixtures are
 * built with the real `node:sqlite` writer so they carry the physical framing
 * ZCode produces; the reader opens the store read-only and never writes it.
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectForeignFormat, listForeignSessionFiles, readForeignSession } from '../src/foreign-format-adapters.ts'
import { isZcodeRoot, listZcodeSessions, readZcodeSession } from '../src/zcode-sessions.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** One temporary root this spec owns and removes. */
async function directory(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

/** One SQLite `message.data` payload plus its `part.data` rows. */
interface SqlMessage {
  readonly id: string
  readonly data: string
  readonly parts?: readonly { readonly data: string }[]
}

/** One SQLite `session` row with its messages. */
interface SqlSession {
  readonly id: string
  readonly directory?: string
  readonly time_created?: number
  readonly deleted?: boolean
  readonly messages?: readonly SqlMessage[]
}

/** Write a ZCode-shaped SQLite store at `dbPath`. */
function writeSqliteStore(dbPath: string, sessions: readonly SqlSession[]): void {
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER, time_deleted INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT, sequence INTEGER);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT, sequence INTEGER);
  `)
  const insertSession = db.prepare('INSERT INTO session (id, title, directory, time_created, time_updated, time_deleted) VALUES (?, ?, ?, ?, ?, ?)')
  const insertMessage = db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data, sequence) VALUES (?, ?, ?, ?, ?, ?)')
  const insertPart = db.prepare('INSERT INTO part (id, message_id, session_id, time_created, time_updated, data, sequence) VALUES (?, ?, ?, ?, ?, ?, ?)')
  for (const session of sessions) {
    const created = session.time_created ?? 1_000
    insertSession.run(session.id, 'title', session.directory ?? '', created, created, session.deleted ? created : null)
    const messages = session.messages ?? []
    messages.forEach((message, messageIndex) => {
      insertMessage.run(message.id, session.id, created + messageIndex, created + messageIndex, message.data, messageIndex)
      const parts = message.parts ?? []
      parts.forEach((part, partIndex) => {
        insertPart.run(`part_${message.id}_${partIndex}`, message.id, session.id, created + messageIndex, created + messageIndex, part.data, partIndex)
      })
    })
  }
  db.close()
}

/** The events of one converted session, as plain records. */
async function eventsOf(file: { path: string; sessionId?: string }): Promise<Record<string, unknown>[]> {
  const content = await readZcodeSession({ path: file.path, format: 'zcode', ...(file.sessionId === undefined ? {} : { sessionId: file.sessionId }) })
  return content.events as unknown as Record<string, unknown>[]
}

describe('zcode detection', () => {
  it('detects a ZCode root from the current SQLite store', async () => {
    const root = await directory('zcode-sqlite-detect-')
    await mkdir(join(root, 'cli', 'db'), { recursive: true })
    writeSqliteStore(join(root, 'cli', 'db', 'db.sqlite'), [])
    expect(await isZcodeRoot(root)).toBe(true)
    expect(await detectForeignFormat(root)).toBe('zcode')
  })

  it('detects a ZCode root from the legacy snapshot tree', async () => {
    const root = await directory('zcode-legacy-detect-')
    await mkdir(join(root, 'v2', 'sessions', 'abcdef012345'), { recursive: true })
    expect(await isZcodeRoot(root)).toBe(true)
    expect(await detectForeignFormat(root)).toBe('zcode')
  })

  it('does not treat a plain directory, or a non-hash legacy dir, as ZCode', async () => {
    const root = await directory('zcode-none-')
    expect(await isZcodeRoot(root)).toBe(false)
    expect(await detectForeignFormat(root)).toBe('dsh')
    await mkdir(join(root, 'v2', 'sessions', 'not-a-hash'), { recursive: true })
    expect(await isZcodeRoot(root)).toBe(false)
  })
})

describe('zcode discovery', () => {
  it('lists live SQLite sessions with their id and skips deleted ones', async () => {
    const root = await directory('zcode-list-sqlite-')
    const dbPath = join(root, 'cli', 'db', 'db.sqlite')
    await mkdir(join(root, 'cli', 'db'), { recursive: true })
    writeSqliteStore(dbPath, [
      { id: 'sess_live', time_created: 1 },
      { id: 'sess_gone', deleted: true },
    ])
    const files = await listZcodeSessions(root)
    expect(files).toEqual([{ path: dbPath, format: 'zcode', sessionId: 'sess_live' }])
  })

  it('lists legacy snapshots and skips soft-deleted files and non-hash dirs', async () => {
    const root = await directory('zcode-list-legacy-')
    const sessions = join(root, 'v2', 'sessions')
    await mkdir(join(sessions, 'abcdef012345'), { recursive: true })
    await mkdir(join(sessions, 'ignored'), { recursive: true })
    await writeFile(join(sessions, 'abcdef012345', 'task-1.json'), '{}')
    await writeFile(join(sessions, 'abcdef012345', 'task-1.deleted.json'), '{}')
    await writeFile(join(sessions, 'abcdef012345', 'notes.txt'), 'x')
    await writeFile(join(sessions, 'ignored', 'task-2.json'), '{}')
    const files = await listZcodeSessions(root)
    expect(files).toEqual([{ path: join(sessions, 'abcdef012345', 'task-1.json'), format: 'zcode' }])
  })

  it('skips a database file that is not a ZCode store', async () => {
    const root = await directory('zcode-list-foreign-db-')
    const dbPath = join(root, 'cli', 'db', 'db.sqlite')
    await mkdir(join(root, 'cli', 'db'), { recursive: true })
    const db = new DatabaseSync(dbPath)
    db.exec('CREATE TABLE unrelated (id TEXT)')
    db.close()
    expect(await listZcodeSessions(root)).toEqual([])
  })
})

describe('zcode SQLite conversion', () => {
  it('converts user and assistant turns, joining text and reasoning parts', async () => {
    const root = await directory('zcode-read-sqlite-')
    const dbPath = join(root, 'cli', 'db', 'db.sqlite')
    await mkdir(join(root, 'cli', 'db'), { recursive: true })
    writeSqliteStore(dbPath, [{
      id: 'sess_1',
      directory: '/work/project',
      time_created: 1_700_000_000_000,
      messages: [
        { id: 'msg_u', data: JSON.stringify({ role: 'user' }), parts: [{ data: JSON.stringify({ type: 'text', text: 'fix the build' }) }] },
        { id: 'msg_a', data: JSON.stringify({ role: 'assistant' }), parts: [
          { data: JSON.stringify({ type: 'reasoning', text: 'reading logs' }) },
          { data: JSON.stringify({ type: 'text', text: 'I will read the logs.' }) },
          { data: JSON.stringify({ type: 'tool', state: { status: 'completed', output: 'ok' } }) },
        ] },
      ],
    }])
    const events = await eventsOf({ path: dbPath, sessionId: 'sess_1' })
    expect(events).toEqual([
      { type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: 'fix the build' }], source: { kind: 'user' }, id: 'imported-0' } }, surfaceOp: 'append' },
      { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'reading logs\nI will read the logs.' }], source: { kind: 'assistant' }, id: 'imported-1' } }, surfaceOp: 'append' },
    ])
  })

  it('skips non-user/assistant roles, empty text, and unparseable rows', async () => {
    const root = await directory('zcode-read-sqlite-skip-')
    const dbPath = join(root, 'cli', 'db', 'db.sqlite')
    await mkdir(join(root, 'cli', 'db'), { recursive: true })
    writeSqliteStore(dbPath, [{
      id: 'sess_2',
      messages: [
        { id: 'msg_sys', data: JSON.stringify({ role: 'system' }), parts: [{ data: JSON.stringify({ type: 'text', text: 'sys' }) }] },
        { id: 'msg_empty', data: JSON.stringify({ role: 'user' }), parts: [{ data: JSON.stringify({ type: 'tool', state: { status: 'completed', output: 'x' } }) }] },
        { id: 'msg_bad', data: 'not json', parts: [{ data: JSON.stringify({ type: 'text', text: 'ignored' }) }] },
        { id: 'msg_keep', data: JSON.stringify({ role: 'user' }), parts: [{ data: JSON.stringify({ type: 'text', text: 'kept' }) }] },
      ],
    }])
    const events = await eventsOf({ path: dbPath, sessionId: 'sess_2' })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'user/message', data: { message: { content: [{ text: 'kept' }] } } })
  })

  it('throws when the requested session id is absent', async () => {
    const root = await directory('zcode-read-sqlite-missing-')
    const dbPath = join(root, 'cli', 'db', 'db.sqlite')
    await mkdir(join(root, 'cli', 'db'), { recursive: true })
    writeSqliteStore(dbPath, [])
    await expect(readZcodeSession({ path: dbPath, format: 'zcode', sessionId: 'nope' })).rejects.toThrow(/not present/)
  })
})

describe('zcode legacy conversion', () => {
  /** Write a legacy snapshot and return its path. */
  async function legacy(root: string, file: unknown): Promise<string> {
    const dir = join(root, 'v2', 'sessions', 'abcdef012345')
    await mkdir(dir, { recursive: true })
    const path = join(dir, 'task-1.json')
    await writeFile(path, JSON.stringify(file))
    return path
  }

  it('converts a snapshot using its ordered parts', async () => {
    const root = await directory('zcode-legacy-parts-')
    const path = await legacy(root, {
      meta: { taskId: 'claude-1', title: 't', workspacePath: '/work', createdAt: 42, mode: 'default' },
      messages: [
        { id: 'm1', role: 'user', content: 'hello', timestamp: 42, parts: [{ type: 'content', content: 'hello' }] },
        { id: 'm2', role: 'assistant', content: 'answer', timestamp: 43, parts: [
          { type: 'thought', content: 'thinking' },
          { type: 'content', content: 'answer' },
          { type: 'tool-call', toolIndex: 0 },
        ] },
      ],
    })
    const events = await eventsOf({ path })
    expect(events).toEqual([
      { type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' }, id: 'imported-0' } }, surfaceOp: 'append' },
      { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'thinking\nanswer' }], source: { kind: 'assistant' }, id: 'imported-1' } }, surfaceOp: 'append' },
    ])
  })

  it('falls back to flat content and thought when parts are absent or empty', async () => {
    const root = await directory('zcode-legacy-flat-')
    const path = await legacy(root, {
      meta: { taskId: 't-1', createdAt: 1 },
      messages: [
        { role: 'assistant', content: 'the answer', thought: 'the thought' },
        { role: 'user', content: 'question' },
        { role: 'assistant', content: 'via flat', parts: [{ type: 'tool-call', toolIndex: 0 }] },
      ],
    })
    const events = await eventsOf({ path })
    expect(events.map(e => (e['data'] as { message: { content: { text: string }[] } }).message.content[0]?.text)).toEqual([
      'the thought\nthe answer',
      'question',
      'via flat',
    ])
  })

  it('skips non-user/assistant roles and empty content, and derives id from the filename', async () => {
    const root = await directory('zcode-legacy-skip-')
    const path = await legacy(root, {
      meta: {},
      messages: [
        { role: 'system', content: 'ignored' },
        { role: 'user', content: '' },
        'not-an-object',
        { role: 'user', content: 'kept' },
      ],
    })
    const content = await readZcodeSession({ path, format: 'zcode' })
    expect(content.header.id).toBe('task-1')
    expect(content.header.createdAt).toBeTypeOf('number')
    expect(content.header.cwd).toBeUndefined()
    expect(content.events).toHaveLength(1)
  })

  it('treats a snapshot with a null meta as having defaults', async () => {
    const root = await directory('zcode-legacy-null-meta-')
    const path = await legacy(root, { meta: null, messages: [{ role: 'user', content: 'hi' }] })
    const content = await readZcodeSession({ path, format: 'zcode' })
    expect(content.header.id).toBe('task-1')
    expect(content.events).toHaveLength(1)
  })
})

describe('zcode adapter integration', () => {
  it('imports a SQLite root through the shared detect/list/read flow', async () => {
    const root = await directory('zcode-adapter-sqlite-')
    const dbPath = join(root, 'cli', 'db', 'db.sqlite')
    await mkdir(join(root, 'cli', 'db'), { recursive: true })
    writeSqliteStore(dbPath, [{
      id: 'sess_1',
      directory: '/work/project',
      time_created: 1_700_000_000_000,
      messages: [
        { id: 'm1', data: JSON.stringify({ role: 'user' }), parts: [{ data: JSON.stringify({ type: 'text', text: 'build it' }) }] },
        { id: 'm2', data: JSON.stringify({ role: 'assistant' }), parts: [{ data: JSON.stringify({ type: 'text', text: 'done' }) }] },
      ],
    }])
    const format = await detectForeignFormat(root)
    expect(format).toBe('zcode')
    const files = await listForeignSessionFiles(root, format)
    expect(files).toEqual([{ path: dbPath, format: 'zcode', sessionId: 'sess_1' }])
    const [sqliteFile] = files
    if (sqliteFile === undefined) throw new Error('expected one zcode session file')
    const content = await readForeignSession(sqliteFile)
    expect(content.header.id).toBe('sess_1')
    expect(content.header.cwd).toBe('/work/project')
    expect(content.events).toHaveLength(2)
  })

  it('imports a legacy root through the shared detect/list/read flow', async () => {
    const root = await directory('zcode-adapter-legacy-')
    const dir = join(root, 'v2', 'sessions', 'abcdef012345')
    await mkdir(dir, { recursive: true })
    const path = join(dir, 'task-1.json')
    await writeFile(path, JSON.stringify({ meta: { taskId: 't-1', workspacePath: '/work', createdAt: 5 }, messages: [{ role: 'user', content: 'hello' }] }))
    const format = await detectForeignFormat(root)
    expect(format).toBe('zcode')
    const files = await listForeignSessionFiles(root, format)
    expect(files).toEqual([{ path, format: 'zcode' }])
    const [legacyFile] = files
    if (legacyFile === undefined) throw new Error('expected one zcode session file')
    const content = await readForeignSession(legacyFile)
    expect(content.header.id).toBe('t-1')
    expect(content.header.cwd).toBe('/work')
    expect(content.events).toHaveLength(1)
  })
})
