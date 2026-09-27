/** The `write` endpoint: workspace confinement, the guarded write, and the change feed it feeds. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FsError } from '@mutantcat/dsh-fs'
import { failureOf, openWorkspace, signal, type Harness } from './harness.ts'

let harness: Harness
let workspace: string
let outside: string
/** What the Session lookup returns; one test swaps in a live session. */
let sessionUnderTest: unknown

beforeEach(async () => {
  harness = await openWorkspace('dsh-workspace-files-write-')
  workspace = harness.workspace
  outside = harness.outside
  // The write resolves the Session's sandbox policy through this lookup; an
  // absent session is the deployment-default policy branch.
  harness.ctx.provide('sessions', { get: () => sessionUnderTest } as never)
})

afterEach(async () => {
  await harness.dispose()
})

const endpoint = (): ReturnType<Harness['endpoint']> => harness.endpoint()

const create: { kind: 'createIfAbsent' } = { kind: 'createIfAbsent' }

/** The absolute path the backend reports for `path`, resolved the way it resolves it. */
async function absolutePathOf(path: string): Promise<string> {
  return harness.ctx.fs.processPath(await harness.ctx.fs.resolve(path))
}

describe('workspaceFiles.write — creating a file', () => {
  it('creates an absent file and reports the create and the new version', async () => {
    const outcome = await endpoint().write(harness.scope, 'notes.txt', 'hello\n', create, signal())
    expect(outcome.operation).toBe('create')
    expect(outcome.version.length).toBeGreaterThan(0)
    expect(outcome.absolutePath).toBe(await absolutePathOf(join(workspace, 'notes.txt')))
    expect(await readFile(join(workspace, 'notes.txt'), 'utf8')).toBe('hello\n')
  })

  it('creates missing parent directories on the way to the target', async () => {
    const outcome = await endpoint().write(harness.scope, 'src/deep/a.ts', 'export {}\n', create, signal())
    expect(outcome.operation).toBe('create')
    expect(await readFile(join(workspace, 'src', 'deep', 'a.ts'), 'utf8')).toBe('export {}\n')
  })

  it('creates an empty file, which is not the same as an absent one', async () => {
    const outcome = await endpoint().write(harness.scope, 'empty.txt', '', create, signal())
    expect(outcome.operation).toBe('create')
    expect(await readFile(join(workspace, 'empty.txt'), 'utf8')).toBe('')
  })

  it('accepts an absolute path inside the workspace', async () => {
    const outcome = await endpoint().write(harness.scope, join(workspace, 'abs.txt'), 'x', create, signal())
    expect(outcome.absolutePath).toBe(await absolutePathOf(join(workspace, 'abs.txt')))
  })
})

describe('workspaceFiles.write — replacing a file', () => {
  it('replaces a file still at the guarded version and reports the update', async () => {
    await writeFile(join(workspace, 'notes.txt'), 'before', 'utf8')
    const before = await endpoint().stat(harness.scope, 'notes.txt', signal())
    const outcome = await endpoint().write(
      harness.scope,
      'notes.txt',
      'after',
      { kind: 'replaceIfVersion', version: before.version },
      signal(),
    )
    expect(outcome.operation).toBe('update')
    expect(outcome.version).not.toBe(before.version)
    expect(await readFile(join(workspace, 'notes.txt'), 'utf8')).toBe('after')
  })

  it('refuses a replace whose guard names a stale version', async () => {
    await writeFile(join(workspace, 'notes.txt'), 'before', 'utf8')
    const failure = await failureOf(endpoint().write(
      harness.scope,
      'notes.txt',
      'after',
      { kind: 'replaceIfVersion', version: 'v-another-writer' },
      signal(),
    ))
    expect(failure.code).toBe('workspace-file/stale-version')
    expect(failure.details).toMatchObject({ path: 'notes.txt' })
    expect(await readFile(join(workspace, 'notes.txt'), 'utf8')).toBe('before')
  })

  it('refuses a replace of an absent file: the guard cannot be satisfied', async () => {
    const failure = await failureOf(endpoint().write(
      harness.scope,
      'gone.txt',
      'content',
      { kind: 'replaceIfVersion', version: 'v-anything' },
      signal(),
    ))
    expect(failure.code).toBe('workspace-file/stale-version')
  })

  it('refuses a create onto an existing file, which is a blind overwrite', async () => {
    await writeFile(join(workspace, 'notes.txt'), 'before', 'utf8')
    const failure = await failureOf(endpoint().write(harness.scope, 'notes.txt', 'after', create, signal()))
    expect(failure.code).toBe('workspace-file/stale-version')
    expect(await readFile(join(workspace, 'notes.txt'), 'utf8')).toBe('before')
  })

  it('resolves the sandbox policy from the live session when one is registered', async () => {
    sessionUnderTest = { id: 's-test', header: { cwd: workspace } }
    await writeFile(join(workspace, 'notes.txt'), 'before', 'utf8')
    const before = await endpoint().stat(harness.scope, 'notes.txt', signal())
    const outcome = await endpoint().write(
      harness.scope,
      'notes.txt',
      'after',
      { kind: 'replaceIfVersion', version: before.version },
      signal(),
    )
    expect(outcome.operation).toBe('update')
  })
})

describe('workspaceFiles.write — the workspace boundary', () => {
  it('refuses an absolute path outside the workspace', async () => {
    const failure = await failureOf(endpoint().write(harness.scope, join(outside, 'x.txt'), 'x', create, signal()))
    expect(failure.code).toBe('workspace-file/outside-workspace')
  })

  it('refuses a relative path that climbs out of the workspace', async () => {
    const failure = await failureOf(endpoint().write(harness.scope, '../outside/x.txt', 'x', create, signal()))
    expect(failure.code).toBe('workspace-file/outside-workspace')
  })

  it('refuses a symlink inside the workspace instead of writing through it', async () => {
    await writeFile(join(workspace, 'real.txt'), 'keep', 'utf8')
    await symlink(join(workspace, 'real.txt'), join(workspace, 'alias.txt'))
    const failure = await failureOf(endpoint().write(harness.scope, 'alias.txt', 'through', create, signal()))
    expect(failure.code).toBe('workspace-file/not-regular-file')
    expect(failure.details).toMatchObject({ kind: 'symlink' })
    expect(await readFile(join(workspace, 'real.txt'), 'utf8')).toBe('keep')
  })

  it('refuses a symlink whose destination leaves the workspace', async () => {
    await writeFile(join(outside, 'secret.txt'), 'keep', 'utf8')
    await symlink(join(outside, 'secret.txt'), join(workspace, 'escape.txt'))
    const failure = await failureOf(endpoint().write(harness.scope, 'escape.txt', 'through', create, signal()))
    expect(failure.code).toBe('workspace-file/outside-workspace')
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('keep')
  })

  it('refuses a directory, which has no content to replace', async () => {
    await mkdir(join(workspace, 'src'), { recursive: true })
    const failure = await failureOf(endpoint().write(harness.scope, 'src', 'x', create, signal()))
    expect(failure.code).toBe('workspace-file/not-regular-file')
    expect(failure.details).toMatchObject({ kind: 'directory' })
  })

  it('refuses an empty path as a bad request', async () => {
    const failure = await failureOf(endpoint().write(harness.scope, '', 'x', create, signal()))
    expect(failure.code).toBe('gateway/bad-request')
  })
})

describe('workspaceFiles.write — backend failures', () => {
  it('reports a sandbox denial as its own code', async () => {
    const spy = vi.spyOn(harness.ctx.fs, 'writeText').mockRejectedValue(new FsError('denied', 'FS_SANDBOX_DENIED'))
    const failure = await failureOf(endpoint().write(harness.scope, 'notes.txt', 'x', create, signal()))
    expect(failure.code).toBe('workspace-file/sandbox-denied')
    expect(failure.details).toMatchObject({ path: 'notes.txt' })
    spy.mockRestore()
  })

  it('reports a backend refusal the write codes do not name as a generic failure', async () => {
    const spy = vi.spyOn(harness.ctx.fs, 'writeText').mockRejectedValue(new FsError('disk on fire', 'FS_IO_ERROR'))
    const failure = await failureOf(endpoint().write(harness.scope, 'notes.txt', 'x', create, signal()))
    expect(failure.code).toBe('workspace-file/write-failed')
    spy.mockRestore()
  })

  it('reports an error carrying no backend code as a generic failure', async () => {
    const spy = vi.spyOn(harness.ctx.fs, 'writeText').mockRejectedValue(new Error('boom'))
    const failure = await failureOf(endpoint().write(harness.scope, 'notes.txt', 'x', create, signal()))
    expect(failure.code).toBe('workspace-file/write-failed')
    spy.mockRestore()
  })
})

describe('workspaceFiles.write — the change feed', () => {
  it('reports the write to open changes generations as a present observation', async () => {
    const service = harness.endpoint()
    const controller = new AbortController()
    const iterator = service.changes(harness.scope, controller.signal)[Symbol.asyncIterator]()
    try {
      await expect(iterator.next()).resolves.toEqual({ done: false, value: { kind: 'ready' } })
      const pending = iterator.next()
      const outcome = await service.write(harness.scope, 'fresh.txt', 'hello', create, signal())
      expect(await pending).toEqual({
        done: false,
        value: { kind: 'change', change: { absolutePath: outcome.absolutePath, version: outcome.version } },
      })
    } finally {
      controller.abort()
      await iterator.return?.()
    }
  })
})
