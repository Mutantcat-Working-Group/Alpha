/** The complete-text read walks every page to the file's end. */
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@mutantcat/dsh-session/types'
import { RemoteError } from '@mutantcat/dsh-client-test-runtime'
import type { WorkspaceFileText } from '@mutantcat/dsh-api-workspace-files/types'
import { readEditorText } from '../src/client/editor/read.ts'
import type { ReadWorkspaceFilePage } from '../src/client/rpc.ts'

const file = { sessionId: 'editor-read' as SessionId, path: 'source.ts' }

function page(offset: number, text: string, lines: number, eof: boolean, version = 'v1'): WorkspaceFileText {
  return { absolutePath: '/workspace/source.ts', version, offset, text, lines, eof }
}

/** Replays the given pages in order, holding the last one for any further call. */
function pager(pages: readonly WorkspaceFileText[]): ReadWorkspaceFilePage {
  let served = 0
  return vi.fn<ReadWorkspaceFilePage>(async () => {
    const next = pages[Math.min(served, pages.length - 1)]!
    served += 1
    return { ok: true, value: next }
  })
}

describe('readEditorText', () => {
  it('joins every page up to the file end and reports the first page version', async () => {
    const read = pager([page(1, 'first line', 1, false), page(2, 'second line', 1, false), page(3, 'last line', 1, true)])
    const result = await readEditorText(read, file, new AbortController().signal, () => new Error('drifted'))
    expect(result).toEqual({ ok: true, value: { text: 'first line\nsecond line\nlast line', version: 'v1' } })
    expect(read).toHaveBeenCalledTimes(3)
    expect(read).toHaveBeenNthCalledWith(1, file.sessionId, file.path, 1, expect.any(AbortSignal))
    expect(read).toHaveBeenNthCalledWith(3, file.sessionId, file.path, 3, expect.any(AbortSignal))
  })

  it('reads a single-page file without joining', async () => {
    const read = pager([page(1, 'only line', 1, true, 'v9')])
    expect(await readEditorText(read, file, new AbortController().signal, () => new Error('drifted')))
      .toEqual({ ok: true, value: { text: 'only line', version: 'v9' } })
    expect(read).toHaveBeenCalledOnce()
  })

  it('settles an empty file on its terminating empty page', async () => {
    const read = pager([page(1, '', 0, true)])
    expect(await readEditorText(read, file, new AbortController().signal, () => new Error('drifted')))
      .toEqual({ ok: true, value: { text: '', version: 'v1' } })
    expect(read).toHaveBeenCalledOnce()
  })

  it('advances past an empty page instead of spinning on it', async () => {
    const read = pager([page(1, 'head', 1, false), page(2, '', 0, false), page(3, 'tail', 1, true)])
    const result = await readEditorText(read, file, new AbortController().signal, () => new Error('drifted'))
    expect(result).toEqual({ ok: true, value: { text: 'head\ntail', version: 'v1' } })
    expect(read).toHaveBeenCalledTimes(3)
    expect(read).toHaveBeenNthCalledWith(3, file.sessionId, file.path, 3, expect.any(AbortSignal))
  })

  it('refuses pages of two versions joined', async () => {
    const read = pager([page(1, 'head', 1, false), page(2, 'tail', 1, true, 'v2')])
    await expect(readEditorText(read, file, new AbortController().signal, () => new Error('drifted')))
      .rejects.toThrow('drifted')
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('returns the first declared failure without walking further', async () => {
    const failure = new RemoteError('workspace-file/not-found', 'File missing', { path: file.path })
    const read = vi.fn<ReadWorkspaceFilePage>().mockResolvedValue({ ok: false, error: failure })
    expect(await readEditorText(read, file, new AbortController().signal, () => new Error('drifted'))).toEqual({ ok: false, error: failure })
    expect(read).toHaveBeenCalledOnce()
  })

  it('stops on an aborted signal between pages', async () => {
    const read = pager([page(1, 'head', 1, false), page(2, 'tail', 1, true)])
    const controller = new AbortController()
    controller.abort()
    await expect(readEditorText(read, file, controller.signal, () => new Error('drifted')))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(read).toHaveBeenCalledOnce()
  })
})
