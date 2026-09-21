// @vitest-environment jsdom
/** Editor registration lifetimes through the production document and Slot registries. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'
import { Context } from '@mutantcat/cordis'
import type { SessionId } from '@mutantcat/dsh-session/types'
import type { ClientRemote } from '@mutantcat/dsh-api-remotes/client'
import { makeTranslate, RemoteError, SlotTestRuntime } from '@mutantcat/dsh-client-test-runtime'
import { LocaleRuntime } from '@mutantcat/dsh-client-locale/client'
import type { TabId } from '@mutantcat/dsh-client-ui-dockkit'
import { apply } from '../src/client/editor/index.ts'
import { EditorBody } from '../src/client/editor/EditorBody.tsx'
import type { EditorBodyInjected, RetainedEditorState } from '../src/client/editor/EditorBody.tsx'
import type { EditorStore } from '../src/client/editor/store.ts'
import { EDITOR_EXTENSIONS } from '../src/client/editor/languages.ts'
import { en, zh } from '../src/client/editor/locales.ts'
import { en as documentEn } from '../src/client/locales.ts'
import { DocumentPreviewRegistry } from '../src/client/document/registry.ts'
import { documentTabInfoFactory } from '../src/client/document/contract.ts'

const ID = '@mutantcat/dsh-client-ui-sidebar-documentpreview/editor'
const SLOT = 'sidebar.right.tab.document'
const plugin = { inject: ['slots', 'locale', 'documentPreviews'], apply }
let runtime: SlotTestRuntime | undefined

afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
})

async function boot() {
  const rt = await SlotTestRuntime.create()
  runtime = rt
  const locale = new LocaleRuntime(rt.ctx)
  rt.ctx.provide('locale', locale)
  rt.slots.installLocale(locale)
  const previews = new DocumentPreviewRegistry()
  rt.ctx.provide('documentPreviews', previews)
  const declare = () => rt.declare({
    [SLOT]: { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: documentTabInfoFactory } } },
  })
  return { rt, locale, previews, declare }
}

describe('editor renderer registration', () => {
  it('publishes extension metadata before the document slot exists and waits to register its body', async () => {
    const h = await boot()
    await h.rt.mount(plugin)
    expect(h.previews.getSnapshot()).toHaveLength(1)
    expect(h.previews.getSnapshot()[0]).toMatchObject({
      id: ID, extensions: EDITOR_EXTENSIONS, priority: 'optional', loading: 'renderer', wrap: true,
    })
    expect(h.previews.getSnapshot()[0]).not.toHaveProperty('binaryExtensions')
    expect(h.rt.slots.entries(SLOT)).toEqual([])
    await h.declare()
    const entries = h.rt.slots.entries(SLOT)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ options: { key: ID }, locale: 'sidebarEditor', component: EditorBody })
  })

  it('resolves localized names at read time and removes metadata, locale, and body on disposal', async () => {
    const h = await boot()
    await h.declare()
    const feature = await h.rt.mount(plugin)
    const definition = h.previews.getSnapshot()[0]
    await act(async () => { h.locale.setLocale('en') })
    expect(definition?.title()).toBe(en.title)
    await act(async () => { h.locale.setLocale('zh') })
    expect(definition?.title()).toBe(zh.title)
    await feature.dispose()
    expect(h.previews.getSnapshot()).toEqual([])
    expect(h.rt.slots.entries(SLOT)).toEqual([])
    expect(h.locale.bind('sidebarEditor')('title')).toBe('title')
  })

  it('offers the editor beneath the builtin code preview for a shared suffix', async () => {
    const h = await boot()
    await h.declare()
    h.rt.ctx.effect(() => h.previews.register({
      id: 'builtin-code', extensions: ['ts', 'py'], priority: 'builtin',
      title: () => 'Code', loading: 'text-pages', wrap: true,
    }))
    await h.rt.mount(plugin)
    expect(h.previews.candidates('a.ts').map(item => item.id)).toEqual(['builtin-code', ID])
    expect(h.previews.candidates('a.py').map(item => item.id)).toEqual(['builtin-code', ID])
    expect(h.previews.candidates('a.unknownextension')).toEqual([])
  })
})

const file = { sessionId: 'editor-registration' as SessionId, path: 'source.ts' }
const firstPage = { absolutePath: '/workspace/source.ts', version: 'v1', offset: 1, text: 'head', lines: 1, eof: false }
const lastPage = { absolutePath: '/workspace/source.ts', version: 'v1', offset: 2, text: 'tail', lines: 1, eof: true }
const written = { absolutePath: '/workspace/source.ts', operation: 'update', version: 'v2' } as const

type RecordedOptions = {
  readonly name: string
  readonly store: EditorStore
  readonly inject: (
    sessionId: SessionId,
    actions: ReturnType<EditorStore['create']>['actions'],
  ) => EditorBodyInjected
}

/** Boot the plugin against recorded slot registrations, optionally without the Remote face. */
async function harness(missing?: 'remote') {
  const ctx = new Context()
  const registry = new DocumentPreviewRegistry()
  const removeLocale = vi.fn()
  const locale = {
    register: vi.fn(() => removeLocale),
    bind: (name: string) => name === 'sidebarDocumentPreview' ? makeTranslate(documentEn) : makeTranslate(en),
  }
  const read = vi.fn<ClientRemote['workspaceFiles']['read']>()
    .mockResolvedValueOnce({ ok: true, value: firstPage })
    .mockResolvedValueOnce({ ok: true, value: lastPage })
  const write = vi.fn<ClientRemote['workspaceFiles']['write']>().mockResolvedValue({ ok: true, value: written })
  const recorded: { options: RecordedOptions; component: unknown }[] = []
  const removeSlot = vi.fn()
  const register = vi.fn((options: RecordedOptions, component: unknown) => { recorded.push({ options, component }); return removeSlot })
  ctx.provide('documentPreviews', registry)
  ctx.provide('slots', { inject: (_name: string, effect: () => () => void) => effect(), register } as never)
  ctx.provide('locale', locale as never)
  if (missing !== 'remote') {
    ctx.provide('remote', { workspaceFiles: { read, write } } as never)
    ctx.provide('remote.workspaceFiles', { read, write } as never)
  }
  const fiber = ctx.plugin({ apply })
  await fiber.await()
  const entry = recorded.find(entry => entry.component === EditorBody)!.options
  const instance = entry.store.create()
  const injected = entry.inject(file.sessionId, instance.actions)
  return {
    ctx, registry, instance, injected, locale, removeLocale, read, write, removeSlot,
    signal: () => new AbortController().signal,
    retained: (loadId: number) => ({ loadId }) as RetainedEditorState,
    close: () => fiber.dispose(),
  }
}

describe('editor renderer registration without the Remote face', () => {
  it('keeps registration and guidance when the Remote is absent', async () => {
    const h = await harness('remote')
    try {
      expect(h.locale.register).toHaveBeenCalledWith('sidebarEditor', { zh, en })
      const definition = h.registry.candidates('source.ts')[0]!
      expect(definition.id).toBe(ID)
      expect(definition.title()).toBe(en.title)
      await expect(h.injected.read(file, h.signal())).rejects.toThrow(en.unavailable)
      await expect(h.injected.write(file, 'text', 'v1', h.signal())).rejects.toThrow(en.unavailable)
      expect(h.read).not.toHaveBeenCalled()
      expect(h.write).not.toHaveBeenCalled()
    } finally { await h.close() }
    expect(h.registry.getSnapshot()).toEqual([])
    expect(h.removeLocale).toHaveBeenCalledOnce()
    expect(h.removeSlot).toHaveBeenCalledOnce()
  })
})

describe('editor renderer registration with the Remote face', () => {
  it('walks the paged read and guards the write at the loaded version', async () => {
    const h = await harness()
    try {
      expect(await h.injected.read(file, h.signal())).toEqual({ ok: true, value: { text: 'head\ntail', version: 'v1' } })
      expect(h.read).toHaveBeenCalledTimes(2)
      expect(await h.injected.write(file, 'saved text', 'v1', h.signal())).toEqual({ ok: true, value: written })
      expect(h.write).toHaveBeenCalledWith(
        file.sessionId, file.path, 'saved text', { kind: 'replaceIfVersion', version: 'v1' }, expect.any(AbortSignal),
      )
    } finally { await h.close() }
  })

  it('refuses a read whose pages report two versions', async () => {
    const h = await harness()
    try {
      h.read.mockReset()
        .mockResolvedValueOnce({ ok: true, value: firstPage })
        .mockResolvedValueOnce({ ok: true, value: { ...lastPage, version: 'v2' } })
      await expect(h.injected.read(file, h.signal())).rejects.toThrow(en.changed)
      expect(h.read).toHaveBeenCalledTimes(2)
    } finally { await h.close() }
  })

  it('reverts to the unavailable read and write on disposal', async () => {
    const h = await harness()
    await h.close()
    await expect(h.injected.read(file, h.signal())).rejects.toThrow(en.unavailable)
    await expect(h.injected.write(file, 'text', 'v1', h.signal())).rejects.toThrow(en.unavailable)
  })

  it('describes a declared read failure and an exception in shared document words', async () => {
    const h = await harness()
    try {
      expect(h.injected.describeFailure(new RemoteError('workspace-file/not-found', 'source vanished', { path: file.path })))
        .toBe(documentEn['error.notFound'])
      expect(h.injected.describeFailure({ message: 'connection dropped' }))
        .toBe(documentEn['error.unavailable'].replace('{message}', 'connection dropped'))
    } finally { await h.close() }
  })

  it('forgets tab contents and retained documents on tab close, and all of them on disposal', async () => {
    const h = await harness()
    const open = 'open' as TabId
    const closed = 'closed' as TabId
    const controller = new AbortController()
    try {
      h.instance.actions.complete(open, 1, 'text', 'v1')
      h.instance.actions.complete(closed, 1, 'text', 'v1')
      h.injected.retainTab(open, new AbortController().signal)
      h.injected.retainTab(closed, controller.signal)
      expect(Object.keys(h.instance.getSnapshot().byTab)).toEqual([open, closed])
      h.injected.keepState(open, h.retained(1))
      h.injected.keepState(closed, h.retained(1))
      expect(h.injected.stateOf(open)).toEqual({ loadId: 1 })
      controller.abort()
      expect(h.instance.getSnapshot().byTab[closed]).toBeUndefined()
      expect(h.injected.stateOf(closed)).toBeUndefined()
      expect(h.injected.stateOf(open)).toEqual({ loadId: 1 })
      h.injected.dropState(open)
      expect(h.injected.stateOf(open)).toBeUndefined()
      h.instance.actions.complete(open, 2, 'text', 'v1')
      h.injected.retainTab(open, controller.signal)
      expect(h.instance.getSnapshot().byTab[open]).toBeUndefined()
    } finally { controller.abort(); await h.close() }
    expect(h.instance.getSnapshot().byTab).toEqual({})
  })
})
