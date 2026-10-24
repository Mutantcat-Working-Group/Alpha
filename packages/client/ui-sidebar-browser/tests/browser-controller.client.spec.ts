// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TabId } from '@mutantcat/dsh-client-ui-dockkit'
import type { SessionId } from '@mutantcat/dsh-session/types'
import type { IConversation } from '@mutantcat/dsh-client-ui-conversation/client'
import { randomUUID } from '@mutantcat/dsh-util-crypto'
import { BrowserController, createBrowserControllers } from '../src/client/browser/BrowserController.ts'
import type { ComponentPickerRect, ComponentPickerResult } from '../src/client/browser/BrowserController.ts'
import { createBrowserStore } from '../src/client/browser/store.ts'

vi.mock('@mutantcat/dsh-util-crypto', () => ({
  randomUUID: vi.fn(() => '00000000-0000-4000-8000-000000000000'),
}))

const TAB = 'tab' as TabId
const SESSION = 'session' as SessionId
const APP = 'https://dsh.example'
const lifetimes = new Set<AbortController>()

function lifetime(): AbortController {
  const controller = new AbortController()
  lifetimes.add(controller)
  return controller
}

function conversationStub(accept = true) {
  const attach = vi.fn<(sessionId: SessionId, filename: string, text: string) => boolean>(() => accept)
  const conversation = { attachTextDocument: attach } as unknown as IConversation
  return { conversation, attach }
}

interface PickerRequest {
  readonly requestId: string
  readonly url: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

function pickerBridge() {
  const listeners = new Set<(result: ComponentPickerResult) => void>()
  const start = vi.fn<(request: PickerRequest) => Promise<void>>(() => Promise.resolve())
  const cancel = vi.fn<(requestId: string) => Promise<void>>(() => Promise.resolve())
  const subscribe = vi.fn((listener: (result: ComponentPickerResult) => void) => {
    listeners.add(listener)
    return Promise.resolve(() => { listeners.delete(listener) })
  })
  const bridge = {
    startComponentPicker: (request: PickerRequest) => start(request),
    cancelComponentPicker: (requestId: string) => cancel(requestId),
    onComponentPicker: subscribe,
  }
  return {
    bridge,
    start,
    cancel,
    emit: (result: ComponentPickerResult): void => { for (const listener of [...listeners]) listener(result) },
    listenerCount: (): number => listeners.size,
  }
}

function installBridge(value: unknown): void {
  ;(globalThis as { dshDesktopBoot?: unknown }).dshDesktopBoot = value
}

const RECT: ComponentPickerRect = { x: 10, y: 20, width: 300, height: 200 }

/** Settle the picker's subscribe-then-open microtask chain. */
async function settlePicker(): Promise<void> {
  for (let tick = 0; tick < 4; tick += 1) await Promise.resolve()
}

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  for (const controller of lifetimes) controller.abort()
  lifetimes.clear()
  localStorage.clear()
  delete (globalThis as { dshDesktopBoot?: unknown }).dshDesktopBoot
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('BrowserController', () => {
  it('ignores navigation commands after its tab occurrence ends', () => {
    const store = createBrowserStore().create('browser-controller-ended-test')
    const tabLifetime = lifetime()
    const { conversation } = conversationStub()
    const controller = new BrowserController({
      tabId: TAB, sessionId: SESSION, signal: tabLifetime.signal, applicationOrigin: APP,
      actions: store.actions, conversation,
    })
    tabLifetime.abort()

    controller.loadUrl('https://ignored.example/')
    controller.goBack()
    controller.goForward()
    controller.reload()
    controller.frame.reportLoaded(1)
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
  })

  it('owns the four navigation commands and frame load state', () => {
    const store = createBrowserStore().create('browser-controller-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    expect(face.pickerAvailable).toBe(false)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    const frame = face.keyedHooks.browserFrame(TAB)!
    face.mount(TAB, tabLifetime.signal, APP)
    expect(face.keyedHooks.browserFrame(TAB)).toBe(frame)
    face.goBack(TAB)
    face.goForward(TAB)
    face.reload(TAB)

    face.loadUrl(TAB, 'https://example.test/one')
    const first = frame.getSnapshot().document!
    expect(first.src).toBe('https://example.test/one')
    face.reportLoaded(TAB, first.revision - 1)
    face.reportLoaded(TAB, first.revision)
    expect(store.getSnapshot().byTab[TAB]?.navigation.status).toBe('known')
    face.reportLoaded(TAB, first.revision)
    expect(store.getSnapshot().byTab[TAB]?.navigation.status).toBe('unknown')
    face.goBack(TAB)
    face.goForward(TAB)
    expect(store.getSnapshot().byTab[TAB]?.navigation.status).toBe('unknown')

    face.loadUrl(TAB, 'https://example.test/two')
    face.goBack(TAB)
    expect(frame.getSnapshot().document?.target.url).toBe('https://example.test/one')
    face.goForward(TAB)
    expect(frame.getSnapshot().document?.target.url).toBe('https://example.test/two')
    const beforeReload = store.getSnapshot().byTab[TAB]!.request!.revision
    face.reload(TAB)
    expect(store.getSnapshot().byTab[TAB]?.request?.revision).toBe(beforeReload + 1)
    face.loadUrl(TAB, 'https://example.test/two')
    expect(store.getSnapshot().byTab[TAB]?.request?.revision).toBe(beforeReload + 2)

    tabLifetime.abort()
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
    face.reportLoaded(TAB, first.revision)
    face.loadUrl(TAB, 'https://ignored.example/')
    face.goBack(TAB)
    face.goForward(TAB)
    face.reload(TAB)
  })

  it('does not let an old occurrence delete a replacement controller', () => {
    const store = createBrowserStore().create('browser-controller-replacement-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const first = lifetime()
    const second = lifetime()
    face.mount(TAB, first.signal, APP)
    const original = face.keyedHooks.browserFrame(TAB)
    face.mount(TAB, second.signal, APP)
    const replacement = face.keyedHooks.browserFrame(TAB)
    expect(replacement).not.toBe(original)
    first.abort()
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
    face.loadUrl(TAB, 'https://example.test/')
    expect(store.getSnapshot().byTab[TAB]).toBeDefined()
    face.mount(TAB, second.signal, APP)
    expect(face.keyedHooks.browserFrame(TAB)).toBe(replacement)
  })

  it('loads loopback under sandbox and reloads it across sandbox changes', () => {
    const store = createBrowserStore().create('browser-controller-loopback-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    const frame = face.keyedHooks.browserFrame(TAB)!

    face.loadUrl(TAB, 'http://localhost:5173/app')
    expect(frame.getSnapshot()).toMatchObject({
      sandboxed: true,
      document: { src: 'http://localhost:5173/app' },
    })
    const beforeToggle = store.getSnapshot().byTab[TAB]!.request!.revision

    face.toggleSandbox(TAB)
    expect(frame.getSnapshot().sandboxed).toBe(false)
    expect(frame.getSnapshot().document?.src).toBe('http://localhost:5173/app')
    expect(store.getSnapshot().byTab[TAB]?.request?.revision).toBe(beforeToggle + 1)

    face.toggleSandbox(TAB)
    expect(frame.getSnapshot()).toMatchObject({
      sandboxed: true,
      document: { src: 'http://localhost:5173/app' },
    })
    expect(store.getSnapshot().byTab[TAB]?.request?.revision).toBe(beforeToggle + 2)
  })

  it('loads public HTTP without changing the sandbox policy', () => {
    const store = createBrowserStore().create('browser-controller-http-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)

    face.loadUrl(TAB, 'http://example.test/path')
    expect(face.keyedHooks.browserFrame(TAB)?.getSnapshot()).toMatchObject({
      sandboxed: true,
      document: { src: 'http://example.test/path' },
    })
  })

  it('refuses to pick without the Desktop bridge or a controlled document', () => {
    const store = createBrowserStore().create('browser-controller-picker-absent-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    expect(face.startPicker(TAB, RECT)).toBe(false)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)

    expect(face.startPicker(TAB, RECT)).toBe(false)
    face.loadUrl(TAB, 'https://example.test/one')
    expect(face.startPicker(TAB, RECT)).toBe(false)
    expect(face.keyedHooks.browserFrame(TAB)?.getSnapshot().picker).toBe('inactive')
  })

  it('requires every Desktop picker method before enabling the toolbar', () => {
    const store = createBrowserStore().create('browser-controller-picker-partial-bridge-test')
    const { conversation } = conversationStub()
    const start = vi.fn(() => Promise.resolve())

    installBridge({ startComponentPicker: start })
    expect(createBrowserControllers(store.actions, SESSION, conversation).pickerAvailable).toBe(false)

    installBridge({ startComponentPicker: start, cancelComponentPicker: vi.fn(() => Promise.resolve()) })
    expect(createBrowserControllers(store.actions, SESSION, conversation).pickerAvailable).toBe(false)

    installBridge({
      startComponentPicker: start,
      cancelComponentPicker: vi.fn(() => Promise.resolve()),
      onComponentPicker: vi.fn(() => Promise.resolve(() => {})),
    })
    expect(createBrowserControllers(store.actions, SESSION, conversation).pickerAvailable).toBe(true)
  })

  it('mints a request id through the shared UUID helper', async () => {
    const stub = pickerBridge()
    installBridge(stub.bridge)
    const store = createBrowserStore().create('browser-controller-picker-fallback-id-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    face.loadUrl(TAB, 'https://example.test/one')

    expect(face.startPicker(TAB, RECT)).toBe(true)
    await settlePicker()
    const request = stub.start.mock.calls[0]![0]
    expect(randomUUID).toHaveBeenCalled()
    expect(request.requestId).toBe('00000000-0000-4000-8000-000000000000')
  })

  it('refuses invalid picker rectangles before opening the native picker', () => {
    const stub = pickerBridge()
    installBridge(stub.bridge)
    const store = createBrowserStore().create('browser-controller-picker-rect-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    face.loadUrl(TAB, 'https://example.test/one')
    const frame = face.keyedHooks.browserFrame(TAB)!
    const invalid: readonly ComponentPickerRect[] = [
      { ...RECT, x: -1 },
      { ...RECT, y: -1 },
      { ...RECT, width: 0 },
      { ...RECT, height: 0 },
      { ...RECT, x: Number.POSITIVE_INFINITY },
      { ...RECT, y: Number.POSITIVE_INFINITY },
      { ...RECT, width: Number.POSITIVE_INFINITY },
      { ...RECT, height: Number.POSITIVE_INFINITY },
    ]

    for (const rect of invalid) expect(face.startPicker(TAB, rect)).toBe(false)
    expect(frame.getSnapshot().picker).toBe('inactive')
    expect(stub.start).not.toHaveBeenCalled()
  })

  it('unsubscribes when the picker is stopped before its listener resolves', async () => {
    const registration = deferred<() => void>()
    const unsubscribe = vi.fn()
    const start = vi.fn(() => Promise.resolve())
    installBridge({
      startComponentPicker: start,
      cancelComponentPicker: vi.fn(() => Promise.resolve()),
      onComponentPicker: (_listener: (result: ComponentPickerResult) => void) => {
        return registration.promise.then(() => unsubscribe)
      },
    })
    const store = createBrowserStore().create('browser-controller-picker-race-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    face.loadUrl(TAB, 'https://example.test/one')

    face.startPicker(TAB, RECT)
    face.stopPicker(TAB)
    registration.resolve(() => {})
    await settlePicker()

    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(start).not.toHaveBeenCalled()
  })

  it('attaches the selected component document and leaves picker mode', async () => {
    const stub = pickerBridge()
    installBridge(stub.bridge)
    const store = createBrowserStore().create('browser-controller-picker-select-test')
    const { conversation, attach } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    face.loadUrl(TAB, 'https://example.test/one')
    const frame = face.keyedHooks.browserFrame(TAB)!

    expect(face.pickerAvailable).toBe(true)
    expect(face.startPicker(TAB, RECT)).toBe(true)
    expect(frame.getSnapshot().picker).toBe('active')
    expect(face.startPicker(TAB, RECT)).toBe(false)
    await settlePicker()

    expect(stub.start).toHaveBeenCalledOnce()
    const request = stub.start.mock.calls[0]![0]
    expect(request).toMatchObject({ url: 'https://example.test/one', ...RECT })

    stub.emit({ requestId: request.requestId, status: 'selected', text: 'component metadata' })
    expect(attach).toHaveBeenCalledWith(SESSION, 'example.test.txt', 'component metadata')
    expect(frame.getSnapshot().picker).toBe('inactive')
    expect(stub.listenerCount()).toBe(0)
  })

  it('derives the attachment filename from the target hostname', async () => {
    const stub = pickerBridge()
    installBridge(stub.bridge)
    const store = createBrowserStore().create('browser-controller-picker-filename-test')
    const { conversation, attach } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    face.loadUrl(TAB, 'https://xn--fsq.example/one')
    const frame = face.keyedHooks.browserFrame(TAB)!
    face.startPicker(TAB, RECT)
    await settlePicker()

    stub.emit({ requestId: stub.start.mock.calls[0]![0].requestId, status: 'selected', text: 'metadata' })
    expect(attach).toHaveBeenCalledWith(SESSION, 'xn--fsq.example.txt', 'metadata')
    expect(frame.getSnapshot().picker).toBe('inactive')
  })

  it('reports a native picker error result as a failure', async () => {
    const stub = pickerBridge()
    installBridge(stub.bridge)
    const store = createBrowserStore().create('browser-controller-picker-result-error-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    face.loadUrl(TAB, 'https://example.test/one')
    const frame = face.keyedHooks.browserFrame(TAB)!
    face.startPicker(TAB, RECT)
    await settlePicker()

    stub.emit({
      requestId: stub.start.mock.calls[0]![0].requestId,
      status: 'error',
      message: 'native failure',
    })
    expect(frame.getSnapshot().picker).toBe('failed')
    expect(stub.listenerCount()).toBe(0)
  })

  it('ignores a stale picker result that carries no request id', async () => {
    const listeners = new Set<(result: ComponentPickerResult) => void>()
    installBridge({
      startComponentPicker: vi.fn(() => Promise.resolve()),
      cancelComponentPicker: vi.fn(() => Promise.resolve()),
      onComponentPicker: (listener: (result: ComponentPickerResult) => void) => {
        listeners.add(listener)
        return Promise.resolve(() => { listeners.delete(listener) })
      },
    })
    const store = createBrowserStore().create('browser-controller-picker-no-result-id-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    face.loadUrl(TAB, 'https://example.test/one')
    const frame = face.keyedHooks.browserFrame(TAB)!
    face.startPicker(TAB, RECT)
    await settlePicker()
    const listener = [...listeners][0]!
    face.stopPicker(TAB)

    listener({ requestId: undefined as unknown as string, status: 'cancelled' })
    expect(frame.getSnapshot().picker).toBe('inactive')
  })

  it('leaves picker mode without attaching when the user cancels', async () => {
    const stub = pickerBridge()
    installBridge(stub.bridge)
    const store = createBrowserStore().create('browser-controller-picker-cancel-test')
    const { conversation, attach } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    face.loadUrl(TAB, 'https://example.test/one')
    const frame = face.keyedHooks.browserFrame(TAB)!
    face.startPicker(TAB, RECT)
    await settlePicker()

    const request = stub.start.mock.calls[0]![0]
    stub.emit({ requestId: request.requestId, status: 'cancelled' })
    expect(attach).not.toHaveBeenCalled()
    expect(frame.getSnapshot().picker).toBe('inactive')
    expect(stub.cancel).not.toHaveBeenCalled()
    expect(stub.listenerCount()).toBe(0)
  })

  it('ignores a result from a picker request that already ended', async () => {
    const stub = pickerBridge()
    installBridge(stub.bridge)
    const store = createBrowserStore().create('browser-controller-picker-stale-test')
    const { conversation, attach } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    face.loadUrl(TAB, 'https://example.test/one')
    const frame = face.keyedHooks.browserFrame(TAB)!
    face.startPicker(TAB, RECT)
    await settlePicker()

    stub.emit({ requestId: 'stale-request', status: 'selected', text: 'older request' })
    expect(attach).not.toHaveBeenCalled()
    expect(frame.getSnapshot().picker).toBe('active')

    face.stopPicker(TAB)
    expect(stub.cancel).toHaveBeenCalledWith(stub.start.mock.calls[0]![0].requestId)
    expect(frame.getSnapshot().picker).toBe('inactive')
    expect(stub.listenerCount()).toBe(0)
  })

  it('ignores a native cancel rejection after leaving picker mode', async () => {
    const stub = pickerBridge()
    stub.cancel.mockRejectedValueOnce(new Error('picker already closed'))
    installBridge(stub.bridge)
    const store = createBrowserStore().create('browser-controller-picker-cancel-failure-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    face.loadUrl(TAB, 'https://example.test/one')
    const frame = face.keyedHooks.browserFrame(TAB)!
    face.startPicker(TAB, RECT)
    await settlePicker()

    face.stopPicker(TAB)
    await settlePicker()
    expect(stub.cancel).toHaveBeenCalledOnce()
    expect(frame.getSnapshot().picker).toBe('inactive')
  })

  it('reports a failure when the composer refuses the attachment', async () => {
    const stub = pickerBridge()
    installBridge(stub.bridge)
    const store = createBrowserStore().create('browser-controller-picker-refused-test')
    const { conversation, attach } = conversationStub(false)
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    face.loadUrl(TAB, 'https://example.test/one')
    const frame = face.keyedHooks.browserFrame(TAB)!
    face.startPicker(TAB, RECT)
    await settlePicker()

    stub.emit({ requestId: stub.start.mock.calls[0]![0].requestId, status: 'selected', text: 'metadata' })
    expect(attach).toHaveBeenCalledOnce()
    expect(frame.getSnapshot().picker).toBe('failed')
  })

  it('reports a failure when the native picker cannot open', async () => {
    const stub = pickerBridge()
    stub.start.mockRejectedValueOnce(new Error('window refused'))
    installBridge(stub.bridge)
    const store = createBrowserStore().create('browser-controller-picker-open-failure-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    face.loadUrl(TAB, 'https://example.test/one')
    const frame = face.keyedHooks.browserFrame(TAB)!

    face.startPicker(TAB, RECT)
    await settlePicker()
    expect(frame.getSnapshot().picker).toBe('failed')
    expect(stub.listenerCount()).toBe(0)
  })

  it('ignores a failed picker startup that was already stopped', async () => {
    const startup = deferred<undefined>()
    const stub = pickerBridge()
    stub.start.mockImplementationOnce(() => startup.promise)
    installBridge(stub.bridge)
    const store = createBrowserStore().create('browser-controller-picker-stale-failure-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    face.loadUrl(TAB, 'https://example.test/one')
    const frame = face.keyedHooks.browserFrame(TAB)!

    face.startPicker(TAB, RECT)
    await settlePicker()
    face.stopPicker(TAB)
    startup.reject(new Error('picker closed'))
    await settlePicker()
    expect(frame.getSnapshot().picker).toBe('inactive')
  })

  it('cancels the native picker on navigation and on occurrence teardown', async () => {
    const stub = pickerBridge()
    installBridge(stub.bridge)
    const store = createBrowserStore().create('browser-controller-picker-lifecycle-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    face.loadUrl(TAB, 'https://example.test/one')

    face.startPicker(TAB, RECT)
    await settlePicker()
    const navigated = stub.start.mock.calls[0]![0].requestId
    face.loadUrl(TAB, 'https://example.test/two')
    expect(stub.cancel).toHaveBeenCalledWith(navigated)

    face.startPicker(TAB, RECT)
    await settlePicker()
    const torn = stub.start.mock.calls[1]![0].requestId
    tabLifetime.abort()
    expect(stub.cancel).toHaveBeenCalledWith(torn)
  })
})
