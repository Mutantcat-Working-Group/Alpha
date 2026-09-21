// @vitest-environment jsdom
/**
 * One file revision as an editable CodeMirror document: the first read, the
 * guarded save with its failure lines, reload under a newer revision, the
 * retained document a remount restores, and the failure and non-renderer
 * states that replace the editor.
 */
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { Mock } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceFileWriteOutcome } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { EditorBody } from '../src/client/editor/EditorBody.tsx'
import type { EditorBodyProps, RetainedEditorState } from '../src/client/editor/EditorBody.tsx'
import { createEditorStore } from '../src/client/editor/store.ts'
import type { EditorStore } from '../src/client/editor/store.ts'
import { en } from '../src/client/editor/locales.ts'
import { hostFileOf } from '../src/client/rpc.ts'
import type { WriteWorkspaceFile } from '../src/client/rpc.ts'
import type { EditorText, ReadEditorText } from '../src/client/editor/read.ts'
import type { DocumentContent } from '../src/client/document/contract.ts'

const SESSION = 'editor-body' as SessionId
const TAB = 'tab-1' as TabId
const ADDRESS = sessionFileAddress(SESSION, 'source.ts')
/** What the address names, as the read and write calls receive it. */
const FILE = hostFileOf(ADDRESS)

afterEach(() => { cleanup() })

function readOk(text: string, version = 'v1'): RemoteResult<EditorText> {
  return { ok: true, value: { text, version } }
}

function writeOk(): RemoteResult<WorkspaceFileWriteOutcome> {
  return { ok: true, value: { absolutePath: '/workspace/source.ts', operation: 'update', version: 'v2' } }
}

function refused(
  code: 'workspace-file/stale-version' | 'workspace-file/sandbox-denied' | 'workspace-file/write-failed',
  message: string,
): RemoteResult<WorkspaceFileWriteOutcome> {
  return { ok: false, error: new RemoteError(code, message, { path: FILE.path }) }
}

/** Flush read and write promises that resolved since the last render, then React's work. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** One pending write, so the saving state can be observed before it lands. */
function deferredWrite(): {
  promise: Promise<RemoteResult<WorkspaceFileWriteOutcome>>
  resolve: (result: RemoteResult<WorkspaceFileWriteOutcome>) => void
  reject: (error: unknown) => void
} {
  let resolve!: (result: RemoteResult<WorkspaceFileWriteOutcome>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<RemoteResult<WorkspaceFileWriteOutcome>>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** One pending read, so an abort can race the settlement. */
function deferredRead(): {
  promise: Promise<RemoteResult<EditorText>>
  resolve: (result: RemoteResult<EditorText>) => void
  reject: (error: unknown) => void
} {
  let resolve!: (result: RemoteResult<EditorText>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<RemoteResult<EditorText>>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** Test-local selector hook over a framework-neutral store instance. */
function hookOf<T>(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(sel: (s: T) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot))
  }
}

function viewOf(root: HTMLElement): EditorView {
  const content = root.querySelector<HTMLElement>('.cm-content')
  if (content === null) throw new Error('missing .cm-content')
  const view = EditorView.findFromDOM(content)
  if (view === null) throw new Error('missing editor view')
  return view
}

/** One tab record's harness: the real store, the scripted read and write, and a props builder. */
function setup(path = 'source.ts') {
  const address = sessionFileAddress(SESSION, path)
  const instance: ReturnType<EditorStore['create']> = createEditorStore().create()
  const states = new Map<TabId, RetainedEditorState>()
  const read = vi.fn<ReadEditorText>()
  const write = vi.fn<WriteWorkspaceFile>()
  const describeFailure = vi.fn((failure: RemoteFailure | { readonly message: string }) =>
    'code' in failure ? failure.code : failure.message)
  const retainTab = vi.fn()
  const dropState = vi.fn((tab: TabId) => { states.delete(tab) })
  const controller = new AbortController()
  onTestFinished(() => { controller.abort() })
  const faces: { revision: number; loaded: Mock; reload: Mock }[] = []
  // Injected callbacks keep one identity across renders, the way the plugin's
  // inject provides them, so a rerender never re-runs the mount effect.
  const useStore = hookOf(instance)
  const stateOf = (tab: TabId): RetainedEditorState | undefined => states.get(tab)
  const keepState = (tab: TabId, retained: RetainedEditorState): void => { states.set(tab, retained) }
  const t = (key: string, params?: Record<string, unknown>): string => {
    const line = en[key as keyof typeof en]
    return params === undefined ? line : line.replace('{message}', String(params.message))
  }
  const props = (revision: number, wrap = false, content?: DocumentContent): EditorBodyProps => {
    let owned: DocumentContent
    if (content === undefined) {
      const loaded = vi.fn<(version: string) => void>()
      const reload = vi.fn<() => void>()
      faces.push({ revision, loaded, reload })
      owned = { kind: 'renderer', revision, loaded, reload }
    } else {
      owned = content
    }
    return {
      resourceAddress: address,
      sessionId: SESSION,
      content: owned,
      wrap,
      scrollportRef: () => {},
      useTabInfo: () => ({
        sidebar: { expanded: true, fullscreen: false },
        panel: { id: 'pane-1' },
        tab: { id: TAB, signal: controller.signal },
      }),
      useStore,
      actions: instance.actions,
      read,
      write,
      describeFailure,
      retainTab,
      stateOf,
      keepState,
      dropState,
      t,
    } as unknown as EditorBodyProps
  }
  return { instance, states, read, write, describeFailure, retainTab, dropState, controller, faces, props }
}

describe('EditorBody', () => {
  it('reads the complete file once and shows it as an editable document', async () => {
    const h = setup()
    h.read.mockResolvedValue(readOk('const answer = 42'))
    const view = render(<EditorBody {...h.props(1)} />)
    expect(view.container.querySelector('[data-document-loading]')?.getAttribute('aria-label')).toBe(en.loading)
    expect(view.container.querySelector('[data-editor]')).toBeNull()
    await settle()
    expect(view.container.querySelector('.cm-editor')).not.toBeNull()
    expect(view.container.querySelector('.cm-content')?.textContent).toBe('const answer = 42')
    expect(h.read).toHaveBeenCalledTimes(1)
    expect(h.read).toHaveBeenCalledWith(FILE, expect.any(AbortSignal))
    expect(h.faces[0]?.loaded).toHaveBeenCalledWith('v1')
    expect(view.container.querySelector('[data-editor-strip]')).toBeNull()
    expect(h.retainTab).toHaveBeenCalledWith(TAB, h.controller.signal)
    expect(h.instance.getSnapshot().byTab[TAB]).toEqual({
      revision: 1, loadId: 1, text: 'const answer = 42', version: 'v1', dirty: false, saving: false,
    })
  })

  it('writes the edited document at the version it read and settles clean', async () => {
    const h = setup()
    h.read.mockResolvedValue(readOk('const answer = 42'))
    const pending = deferredWrite()
    h.write.mockReturnValue(pending.promise)
    const view = render(<EditorBody {...h.props(1)} />)
    await settle()
    act(() => { viewOf(view.container).dispatch({ changes: { from: 0, insert: 'X' } }) })
    const save = view.container.querySelector<HTMLButtonElement>('[data-editor-save]')
    expect(save).not.toBeNull()
    act(() => { save?.click() })
    expect(save?.disabled).toBe(true)
    expect(save?.textContent).toContain(en.saving)
    expect(h.write).toHaveBeenCalledWith(FILE, 'Xconst answer = 42', 'v1', expect.any(AbortSignal))
    // A second save while one is in flight is refused by the saving guard.
    fireEvent.keyDown(viewOf(view.container).contentDOM, { key: 's', ctrlKey: true })
    expect(h.write).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve(writeOk())
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(view.container.querySelector('[data-editor-strip]')).toBeNull()
    expect(h.instance.getSnapshot().byTab[TAB]).toMatchObject({
      text: 'Xconst answer = 42', version: 'v2', dirty: false, saving: false,
    })
    expect(h.faces[0]?.loaded).toHaveBeenLastCalledWith('v2')
  })

  it('saves on Mod-s once the document is edited', async () => {
    const h = setup()
    h.read.mockResolvedValue(readOk('const answer = 42'))
    h.write.mockResolvedValue(writeOk())
    const view = render(<EditorBody {...h.props(1)} />)
    await settle()
    const editor = viewOf(view.container)
    fireEvent.keyDown(editor.contentDOM, { key: 's', ctrlKey: true })
    expect(h.write).not.toHaveBeenCalled()
    act(() => { editor.dispatch({ changes: { from: 0, insert: 'X' } }) })
    fireEvent.keyDown(editor.contentDOM, { key: 's', ctrlKey: true })
    await waitFor(() => { expect(h.write).toHaveBeenCalledTimes(1) })
    await waitFor(() => { expect(view.container.querySelector('[data-editor-strip]')).toBeNull() })
  })

  it('offers a discard after a stale-version refusal and reloads the file from disk', async () => {
    const h = setup()
    h.read.mockResolvedValueOnce(readOk('first'))
    h.write.mockResolvedValue(refused('workspace-file/stale-version', 'changed on disk'))
    const view = render(<EditorBody {...h.props(1)} />)
    await settle()
    act(() => { viewOf(view.container).dispatch({ changes: { from: 0, insert: 'X' } }) })
    const save = view.container.querySelector<HTMLButtonElement>('[data-editor-save]')
    act(() => { save?.click() })
    await settle()
    const strip = view.container.querySelector('[data-editor-strip]')
    expect(strip?.textContent).toContain(en['error.staleVersion'])
    const discard = view.container.querySelector<HTMLButtonElement>('[data-editor-discard]')
    expect(discard?.textContent).toBe(en.discard)
    h.read.mockResolvedValueOnce(readOk('second', 'v2'))
    act(() => { discard?.click() })
    expect(h.faces[0]?.reload).toHaveBeenCalled()
    expect(h.dropState).toHaveBeenCalledWith(TAB)
    await waitFor(() => { expect(view.container.querySelector('.cm-content')?.textContent).toBe('second') })
    expect(h.read).toHaveBeenCalledTimes(2)
    expect(h.instance.getSnapshot().byTab[TAB]).toMatchObject({
      loadId: 2, text: 'second', version: 'v2', dirty: false,
    })
  })

  it('reports a sandbox refusal without offering a discard and leaves the save enabled', async () => {
    const h = setup()
    h.read.mockResolvedValue(readOk('const answer = 42'))
    h.write.mockResolvedValue(refused('workspace-file/sandbox-denied', 'denied by policy'))
    const view = render(<EditorBody {...h.props(1)} />)
    await settle()
    act(() => { viewOf(view.container).dispatch({ changes: { from: 0, insert: 'X' } }) })
    const save = view.container.querySelector<HTMLButtonElement>('[data-editor-save]')
    act(() => { save?.click() })
    await settle()
    expect(view.container.querySelector('[data-editor-strip]')?.textContent).toContain(en['error.sandboxDenied'])
    expect(view.container.querySelector('[data-editor-discard]')).toBeNull()
    expect(view.container.querySelector<HTMLButtonElement>('[data-editor-save]')?.disabled).toBe(false)
  })

  it('carries the carrier message when the write fails', async () => {
    const h = setup()
    h.read.mockResolvedValue(readOk('const answer = 42'))
    h.write.mockResolvedValue(refused('workspace-file/write-failed', 'disk full'))
    const view = render(<EditorBody {...h.props(1)} />)
    await settle()
    act(() => { viewOf(view.container).dispatch({ changes: { from: 0, insert: 'X' } }) })
    const save = view.container.querySelector<HTMLButtonElement>('[data-editor-save]')
    act(() => { save?.click() })
    await settle()
    expect(view.container.querySelector('[data-editor-strip]')?.textContent).toContain('Write failed: disk full')
  })

  it('reports a rejected write beside the unsaved text', async () => {
    const h = setup()
    h.read.mockResolvedValue(readOk('const answer = 42'))
    h.write.mockRejectedValue(new Error('socket closed'))
    const view = render(<EditorBody {...h.props(1)} />)
    await settle()
    act(() => { viewOf(view.container).dispatch({ changes: { from: 0, insert: 'X' } }) })
    const save = view.container.querySelector<HTMLButtonElement>('[data-editor-save]')
    act(() => { save?.click() })
    await settle()
    expect(view.container.querySelector('[data-editor-strip]')?.textContent).toContain('Write failed: socket closed')
    expect(h.instance.getSnapshot().byTab[TAB]?.dirty).toBe(true)
  })

  it('carries a write rejection that is not an Error into the failure line', async () => {
    const h = setup()
    h.read.mockResolvedValue(readOk('const answer = 42'))
    h.write.mockRejectedValue('plain string')
    const view = render(<EditorBody {...h.props(1)} />)
    await settle()
    act(() => { viewOf(view.container).dispatch({ changes: { from: 0, insert: 'X' } }) })
    const save = view.container.querySelector<HTMLButtonElement>('[data-editor-save]')
    act(() => { save?.click() })
    await settle()
    expect(view.container.querySelector('[data-editor-strip]')?.textContent).toContain('Write failed: plain string')
  })

  it('keeps the failure announced and the save disabled when the document returns to its saved text', async () => {
    const h = setup()
    h.read.mockResolvedValue(readOk('const answer = 42'))
    h.write.mockResolvedValue(refused('workspace-file/sandbox-denied', 'denied by policy'))
    const view = render(<EditorBody {...h.props(1)} />)
    await settle()
    const editor = viewOf(view.container)
    act(() => { editor.dispatch({ changes: { from: 0, insert: 'X' } }) })
    const save = view.container.querySelector<HTMLButtonElement>('[data-editor-save]')
    act(() => { save?.click() })
    await settle()
    act(() => { editor.dispatch({ changes: { from: 0, to: 1 } }) })
    expect(view.container.querySelector('[data-editor-strip]')?.textContent).toContain(en['error.sandboxDenied'])
    expect(view.container.querySelector<HTMLButtonElement>('[data-editor-save]')?.disabled).toBe(true)
  })

  it('shows a declared read failure and reloads on retry', async () => {
    const h = setup()
    h.read.mockResolvedValue({ ok: false, error: new RemoteError('workspace-file/not-found', 'gone', { path: FILE.path }) })
    const view = render(<EditorBody {...h.props(1)} />)
    await settle()
    expect(view.container.querySelector('[data-editor-failed="workspace-file/not-found"]')).not.toBeNull()
    expect(view.container.querySelector('p')?.textContent).toBe('workspace-file/not-found')
    fireEvent.click(view.getByRole('button', { name: en.retry }))
    expect(h.faces[0]?.reload).toHaveBeenCalled()
  })

  it('shows an internal failure when the read rejects', async () => {
    const h = setup()
    h.read.mockRejectedValue(new Error('connection lost'))
    const view = render(<EditorBody {...h.props(1)} />)
    await settle()
    expect(view.container.querySelector('[data-editor-failed="gateway/internal"]')).not.toBeNull()
    expect(view.container.querySelector('p')?.textContent).toBe('connection lost')
  })

  it('carries a read rejection that is not an Error as its own text', async () => {
    const h = setup()
    h.read.mockRejectedValue('plain string')
    const view = render(<EditorBody {...h.props(1)} />)
    await settle()
    expect(view.container.querySelector('[data-editor-failed="gateway/internal"]')).not.toBeNull()
    expect(view.container.querySelector('p')?.textContent).toBe('plain string')
  })

  it('stays loading and skips the read when the tab is already closed', () => {
    const h = setup()
    h.controller.abort()
    const view = render(<EditorBody {...h.props(1)} />)
    expect(h.read).not.toHaveBeenCalled()
    expect(view.container.querySelector('[data-document-loading]')).not.toBeNull()
    expect(h.faces[0]?.loaded).not.toHaveBeenCalled()
  })

  it('abandons a read that settles after the body unmounts', async () => {
    const h = setup()
    const pending = deferredRead()
    h.read.mockReturnValue(pending.promise)
    const view = render(<EditorBody {...h.props(1)} />)
    view.unmount()
    await act(async () => { pending.resolve(readOk('first')) })
    expect(h.instance.getSnapshot().byTab[TAB]).toEqual({ revision: 1, loadId: 0, dirty: false, saving: false })
  })

  it('abandons a read that rejects after the body unmounts', async () => {
    const h = setup()
    const pending = deferredRead()
    h.read.mockReturnValue(pending.promise)
    const view = render(<EditorBody {...h.props(1)} />)
    view.unmount()
    await act(async () => { pending.reject(new Error('too late')) })
    expect(h.instance.getSnapshot().byTab[TAB]).toEqual({ revision: 1, loadId: 0, dirty: false, saving: false })
  })

  it('leaves a save unsettled when it lands after the tab closed', async () => {
    const h = setup()
    h.read.mockResolvedValue(readOk('first'))
    const pending = deferredWrite()
    h.write.mockReturnValue(pending.promise)
    const view = render(<EditorBody {...h.props(1)} />)
    await settle()
    act(() => { viewOf(view.container).dispatch({ changes: { from: 0, insert: 'X' } }) })
    const save = view.container.querySelector<HTMLButtonElement>('[data-editor-save]')
    act(() => { save?.click() })
    h.controller.abort()
    await act(async () => {
      pending.resolve(writeOk())
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(h.instance.getSnapshot().byTab[TAB]).toMatchObject({ saving: true, dirty: true, version: 'v1' })
  })

  it('leaves a save unsettled when it fails after the tab closed', async () => {
    const h = setup()
    h.read.mockResolvedValue(readOk('first'))
    const pending = deferredWrite()
    h.write.mockReturnValue(pending.promise)
    const view = render(<EditorBody {...h.props(1)} />)
    await settle()
    act(() => { viewOf(view.container).dispatch({ changes: { from: 0, insert: 'X' } }) })
    const save = view.container.querySelector<HTMLButtonElement>('[data-editor-save]')
    act(() => { save?.click() })
    h.controller.abort()
    await act(async () => {
      pending.reject(new Error('socket closed'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(h.instance.getSnapshot().byTab[TAB]).toMatchObject({ saving: true, dirty: true })
    expect(h.instance.getSnapshot().byTab[TAB]?.saveFailure).toBeUndefined()
  })

  it('adopts a newer revision under unsaved edits without re-reading the file', async () => {
    const h = setup()
    h.read.mockResolvedValue(readOk('const answer = 42'))
    const view = render(<EditorBody {...h.props(1)} />)
    await settle()
    const content = view.container.querySelector('.cm-content')
    act(() => { viewOf(view.container).dispatch({ changes: { from: 0, insert: 'X' } }) })
    expect(view.container.querySelector('[data-editor-strip]')).not.toBeNull()
    view.rerender(<EditorBody {...h.props(2)} />)
    expect(h.read).toHaveBeenCalledTimes(1)
    expect(h.instance.getSnapshot().byTab[TAB]).toEqual({
      revision: 2, loadId: 1, text: 'const answer = 42', version: 'v1', dirty: true, saving: false,
    })
    expect(view.container.querySelector('.cm-content')).toBe(content)
    expect(viewOf(view.container).state.doc.toString()).toBe('Xconst answer = 42')
    expect(h.faces[1]?.loaded).toHaveBeenCalledWith('v1')
  })

  it('re-reads the file when a newer revision arrives without unsaved edits', async () => {
    const h = setup()
    h.read.mockResolvedValueOnce(readOk('first')).mockResolvedValueOnce(readOk('second', 'v2'))
    const view = render(<EditorBody {...h.props(1)} />)
    await settle()
    const first = view.container.querySelector('.cm-content')
    view.rerender(<EditorBody {...h.props(2)} />)
    await waitFor(() => { expect(view.container.querySelector('.cm-content')?.textContent).toBe('second') })
    expect(h.read).toHaveBeenCalledTimes(2)
    expect(view.container.querySelector('.cm-content')).not.toBe(first)
    expect(h.instance.getSnapshot().byTab[TAB]).toMatchObject({
      revision: 2, loadId: 2, text: 'second', version: 'v2', dirty: false,
    })
  })

  it('restores the retained document with its unsaved edits when the tab remounts', async () => {
    const h = setup()
    h.read.mockResolvedValue(readOk('first'))
    const view = render(<EditorBody {...h.props(1)} />)
    await settle()
    act(() => { viewOf(view.container).dispatch({ changes: { from: 0, insert: 'X' } }) })
    expect(view.container.querySelector('[data-editor-strip]')).not.toBeNull()
    view.unmount()
    expect(h.states.get(TAB)?.loadId).toBe(1)
    const again = render(<EditorBody {...h.props(1)} />)
    expect(h.read).toHaveBeenCalledTimes(1)
    expect(again.container.querySelector('.cm-content')?.textContent).toBe('Xfirst')
    expect(h.instance.getSnapshot().byTab[TAB]?.dirty).toBe(true)
  })

  it('toggles line wrapping without re-creating the document', async () => {
    const h = setup()
    h.read.mockResolvedValue(readOk('first'))
    const view = render(<EditorBody {...h.props(1, false)} />)
    await settle()
    const content = view.container.querySelector('.cm-content')
    expect(content?.classList.contains('cm-lineWrapping')).toBe(false)
    view.rerender(<EditorBody {...h.props(1, true)} />)
    await waitFor(() => { expect(content?.classList.contains('cm-lineWrapping')).toBe(true) })
    view.rerender(<EditorBody {...h.props(1, false)} />)
    await waitFor(() => { expect(content?.classList.contains('cm-lineWrapping')).toBe(false) })
  })

  it('mounts a wrapped document when the owner asks for wrapping', async () => {
    const h = setup()
    h.read.mockResolvedValue(readOk('first'))
    const view = render(<EditorBody {...h.props(1, true)} />)
    await settle()
    expect(view.container.querySelector('.cm-content')?.classList.contains('cm-lineWrapping')).toBe(true)
  })

  it('mounts an editable document for a suffix no grammar claims', async () => {
    const h = setup('notes.txt')
    h.read.mockResolvedValue(readOk('first'))
    const view = render(<EditorBody {...h.props(1)} />)
    await settle()
    expect(view.container.querySelector('.cm-content')?.textContent).toBe('first')
  })

  it('renders nothing for ordinary text content it does not own', () => {
    const h = setup()
    const view = render(<EditorBody {...h.props(1, false, { kind: 'text', text: 'first', pages: [], eof: true })} />)
    expect(view.container.innerHTML).toBe('')
    expect(h.read).not.toHaveBeenCalled()
  })
})
