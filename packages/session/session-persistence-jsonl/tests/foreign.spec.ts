/**
 * Foreign sessions-root reading: generation selection, header restore, and
 * current-format content restore through the build-static migration chain. The
 * fixtures are raw artifacts of a foreign installation, so nothing here
 * publishes into the root being read.
 */

import { SESSION_FORMAT_VERSION, SessionId } from '@mutantcat/dsh-session'
import type { SessionFormatJsonObject } from '@mutantcat/dsh-session-format'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { generationLogPath, type JsonlCompression } from '../src/format.ts'
import {
  listForeignSessionGenerations,
  readForeignSessionContent,
  readForeignSessionHeader,
} from '../src/foreign.ts'
import { compressZstdFrame } from '../src/zstd.ts'

const CWD = '/work/project'
const config = { provider: 'mock', model: 'mock' }
const question = {
  id: 'question', role: 'user', source: { kind: 'user' },
  content: [{ type: 'text', text: 'Inspect the imported history.' }],
}

/** A released V3 turn, in the rows that generation's writer produced. */
const releasedTurn: readonly SessionFormatJsonObject[] = [
  { type: 'turn/start', data: { turn: 1 } },
  { type: 'step/start', data: { turn: 1, step: 1 } },
  { type: 'user/message', surfaceOp: 'append', data: question },
  { type: 'request/header', data: { header: { config }, reason: 'initial' } },
  { type: 'step/end', data: { turn: 1, step: 1 } },
  { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
]

/** The released V3 descriptor a spawned child Session opened with. */
const childDescriptor: SessionFormatJsonObject = {
  type: 'subagent/descriptor', data: { version: 3, mode: 'continuable', provider: 'spawn', label: 'old child' },
}

/** Extra physical header fields one fixture needs. */
interface HeaderFields {
  readonly origin?: 'subagent'
  readonly parentSession?: string
}

let root: string

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function fixture(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'dsh-jsonl-foreign-'))
  return root
}

/** Write one raw generation exactly as the foreign installation left it. */
async function write(
  id: string,
  version: number,
  compression: JsonlCompression,
  rows: readonly SessionFormatJsonObject[],
  fields: HeaderFields = {},
): Promise<string> {
  const path = generationLogPath(root, CWD, SessionId(id), version, compression)
  const header = {
    type: 'session', version, id, createdAt: 1000, cwd: CWD, isSeeded: false, delegationDepth: 0,
    ...fields,
  }
  const events = rows.map((row, seq) => ({ ...row, seq, time: 1001 + seq }))
  const first = JSON.stringify(header) + '\n'
  const body = events.map(event => JSON.stringify(event) + '\n').join('')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, compression === 'none'
    ? first + body
    : Buffer.concat([await compressZstdFrame(first), ...(body === '' ? [] : [await compressZstdFrame(body)])]))
  return path
}

describe('listForeignSessionGenerations', () => {
  it('selects each Session directory once and returns nothing for an absent root', async () => {
    await fixture()
    await expect(listForeignSessionGenerations(join(root, 'missing'))).resolves.toEqual([])
    await expect(listForeignSessionGenerations(root)).resolves.toEqual([])

    await write('only', 3, 'none', [])
    await writeFile(join(root, 'loose.jsonl'), '{}\n')

    const generations = await listForeignSessionGenerations(root)

    expect(generations).toHaveLength(1)
    expect(generations[0]).toMatchObject({ version: 3, compression: 'none', root })
  })

  it('surfaces an unreadable root and skips entries that are not Session directories', async () => {
    await fixture()
    await writeFile(join(root, 'plain.txt'), 'not a sessions root\n')
    await expect(listForeignSessionGenerations(join(root, 'plain.txt'))).rejects.toMatchObject({ code: 'ENOTDIR' })

    await write('kept', 3, 'none', [])
    await writeFile(join(root, '--work-project--', 'notes.txt'), 'not a session\n')
    // One Session directory holds no canonical generation and one nested
    // directory: neither contributes a generation.
    const empty = join(root, '--work-project--', 'empty')
    await mkdir(join(empty, 'nested'), { recursive: true })
    await writeFile(join(empty, 'README.md'), 'no generation here\n')

    const generations = await listForeignSessionGenerations(root)

    expect(generations.map(generation => generation.path))
      .toEqual([join(root, '--work-project--', 'kept', 'session.v3.jsonl')])
  })

  it('picks the numerically highest generation and prefers Zstandard on a tie', async () => {
    await fixture()
    await write('multi', 2, 'none', [])
    const zstd = await write('multi', 3, 'zstd', releasedTurn)
    await write('multi', 3, 'none', releasedTurn)

    const generations = await listForeignSessionGenerations(root)

    expect(generations).toHaveLength(1)
    expect(generations[0]).toMatchObject({ version: 3, compression: 'zstd', path: zstd })
  })
})

describe('readForeignSessionHeader', () => {
  it('restores a released generation header to the installed format', async () => {
    await fixture()
    await write('header', 3, 'none', [])
    const [generation] = await listForeignSessionGenerations(root)

    const restored = await readForeignSessionHeader(generation!)

    expect(restored.header).toMatchObject({
      version: SESSION_FORMAT_VERSION, id: 'header', cwd: CWD, isSeeded: false, delegationDepth: 0,
    })
    expect(restored.record['version']).toBe(3)
  })

  it('refuses a header that does not own the path it was found at', async () => {
    await fixture()
    const path = join(root, '--work-elsewhere--', 'mismatch', 'session.v3.jsonl')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify({
      type: 'session', version: 3, id: 'mismatch', createdAt: 1000, cwd: CWD,
      isSeeded: false, delegationDepth: 0,
    }) + '\n')

    await expect(readForeignSessionHeader({ root, path, version: 3, compression: 'none' }))
      .rejects.toThrow(/does not own its path/)
  })
})

describe('readForeignSessionHeader refusals', () => {
  it('refuses a header line that is missing, not an object, or an unsupported generation', async () => {
    await fixture()
    const torn = join(root, '--work-project--', 'torn', 'session.v3.jsonl')
    await mkdir(dirname(torn), { recursive: true })
    await writeFile(torn, '{"type":"session","version":3,"id":"torn"}')
    await expect(readForeignSessionHeader({ root, path: torn, version: 3, compression: 'none' }))
      .rejects.toThrow(/header-less session log/)

    const scalar = join(root, '--work-project--', 'scalar', 'session.v3.jsonl')
    await mkdir(dirname(scalar), { recursive: true })
    await writeFile(scalar, 'null\n')
    await expect(readForeignSessionHeader({ root, path: scalar, version: 3, compression: 'none' }))
      .rejects.toThrow(/first line is not a JSON object/)

    const broken = join(root, '--work-project--', 'broken', 'session.v3.jsonl')
    await mkdir(dirname(broken), { recursive: true })
    await writeFile(broken, '{"type":\n')
    await expect(readForeignSessionHeader({ root, path: broken, version: 3, compression: 'none' }))
      .rejects.toThrow(/header line is not valid JSON/)

    const future = join(root, '--work-project--', 'future', 'session.v5.jsonl')
    await mkdir(dirname(future), { recursive: true })
    await writeFile(future, JSON.stringify({
      type: 'session', version: 5, id: 'future', createdAt: 1000, isSeeded: false, delegationDepth: 0,
    }) + '\n')
    await expect(readForeignSessionHeader({ root, path: future, version: 5, compression: 'none' }))
      .rejects.toThrow(/cannot be read/)
  })

  it('restores a header with no working directory and keeps its agent preset', async () => {
    await fixture()
    const path = generationLogPath(root, undefined, SessionId('preset'), 3, 'none')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify({
      type: 'session', version: 3, id: 'preset', createdAt: 1000,
      isSeeded: false, delegationDepth: 0, agentPreset: 'review',
    }) + '\n')

    const restored = await readForeignSessionHeader({ root, path, version: 3, compression: 'none' })

    expect(restored.header).toMatchObject({ id: 'preset', agentPreset: 'review' })
    expect(restored.header).not.toHaveProperty('cwd')
  })

  it('refuses an empty Zstandard generation and a header frame holding several records', async () => {
    await fixture()
    const empty = join(root, '--work-project--', 'zempty', 'session.v3.jsonl.zst')
    await mkdir(dirname(empty), { recursive: true })
    await writeFile(empty, Buffer.alloc(0))
    await expect(readForeignSessionHeader({ root, path: empty, version: 3, compression: 'zstd' }))
      .rejects.toThrow(/header-less Zstandard session log/)

    const packed = join(root, '--work-project--', 'packed', 'session.v3.jsonl.zst')
    await mkdir(dirname(packed), { recursive: true })
    const header = JSON.stringify({
      type: 'session', version: 3, id: 'packed', createdAt: 1000, cwd: CWD, isSeeded: false, delegationDepth: 0,
    })
    await writeFile(packed, await compressZstdFrame(`${header}\n{"type":"turn/start"}\n`))
    await expect(readForeignSessionHeader({ root, path: packed, version: 3, compression: 'zstd' }))
      .rejects.toThrow(/first frame is not exactly one header line/)

    const hollow = join(root, '--work-project--', 'hollow', 'session.v3.jsonl.zst')
    await mkdir(dirname(hollow), { recursive: true })
    await writeFile(hollow, await compressZstdFrame(''))
    await expect(readForeignSessionHeader({ root, path: hollow, version: 3, compression: 'zstd' }))
      .rejects.toThrow(/first frame is not exactly one header line/)
  })
})

describe('readForeignSessionContent', () => {
  it('migrates a released V3 log into contiguous current-format events', async () => {
    await fixture()
    await write('legacy', 3, 'zstd', releasedTurn)
    const [generation] = await listForeignSessionGenerations(root)
    const parent = await readForeignSessionHeader(generation!)

    const content = await readForeignSessionContent(parent, [parent])

    expect(content.header.version).toBe(SESSION_FORMAT_VERSION)
    expect(content.inheritedEventCount).toBe(0)
    expect(content.events.map(event => event.type)).toEqual([
      'turn/start', 'step/start', 'user/message', 'request/header', 'step/end', 'turn/end',
    ])
    expect(content.events.map(event => event.seq)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('restores a spawned child with its lineage and migrated descriptor', async () => {
    await fixture()
    await write('parent', 3, 'none', releasedTurn)
    await write('child', 3, 'none', [childDescriptor], { origin: 'subagent', parentSession: 'parent' })
    const generations = await listForeignSessionGenerations(root)
    const headers = await Promise.all(generations.map(item => readForeignSessionHeader(item)))
    const child = headers.find(item => item.header.id === SessionId('child'))!

    expect(child.header).toMatchObject({
      version: SESSION_FORMAT_VERSION, origin: 'subagent', parentSession: 'parent', delegationDepth: 0,
    })
    const content = await readForeignSessionContent(child, headers)
    expect(content.events.map(event => event.type)).toEqual(['subagent/descriptor'])
    expect(content.events[0]?.seq).toBe(0)

    const parentContent = await readForeignSessionContent(headers.find(item => item.header.id === SessionId('parent'))!, headers)
    expect(parentContent.events.map(event => event.type)).toContain('subagent/catalog')
  })
})
