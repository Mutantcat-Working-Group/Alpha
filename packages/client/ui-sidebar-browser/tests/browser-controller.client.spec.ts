// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TabId } from '@mutantcat/dsh-client-ui-dockkit'
import type { SessionId } from '@mutantcat/dsh-session/types'
import type { IConversation } from '@mutantcat/dsh-client-ui-conversation/client'
import { randomUUID } from '@mutantcat/dsh-util-crypto'
import { BrowserController, createBrowserControllers } from '../src/client/browser/BrowserController.ts'
import type {
  BrowserCarrierRect,
  BrowserDocumentEvent,
  BrowserDocumentMoveRequest,
  BrowserDocumentOpenRequest,
  ComponentPickerResult,
} from '../src/client/browser/BrowserController.ts'
import { createBrowserStore } from '../src/client/browser/store.ts'

vi.mock('@mutantcat/dsh-util-crypto', () => ({
  randomUUID: vi.fn(() => '00000000-0000-4000-8000-000000000000'),
}))

const TAB = 'tab' as TabId
const NATIVE_KEY = 'tab:00000000-0000-4000-8000-000000000000'
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
  readonly key: string
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

function documentBridge() {
  const listeners = new Set<(event: BrowserDocumentEvent) => void>()
  const open = vi.fn<(request: BrowserDocumentOpenRequest) => Promise<void>>(() => Promise.resolve())
  const move = vi.fn<(request: BrowserDocumentMoveRequest) => Promise<void>>(() => Promise.resolve())
  const close = vi.fn<(key: string) => Promise<void>>(() => Promise.resolve())
  const subscribe = vi.fn((listener: (event: BrowserDocumentEvent) => void) => {
    listeners.add(listener)
    return Promise.resolve(() => { listeners.delete(listener) })
  })
  const bridge = {
    openBrowserDocument: (request: BrowserDocumentOpenRequest) => open(request),
    moveBrowserDocument: (request: BrowserDocumentMoveRequest) => move(request),
    closeBrowserDocument: (key: string) => close(key),
    onBrowserDocument: subscribe,
  }
  return {
    bridge,
    open,
    move,
    close,
    emit: (event: BrowserDocumentEvent): void => { for (const listener of [...listeners]) listener(event) },
    listenerCount: (): number => listeners.size,
  }
}

const MOVED: BrowserCarrierRect = { x: 40, y: 50, width: 600, height: 400 }

const RECT: BrowserCarrierRect = { x: 10, y: 20, width: 300, height: 200 }

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
  it('ignores navigation and carrier commands after its tab occurrence ends', () => {
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

    const stub = documentBridge()
    installBridge(stub.bridge)
    controller.openNativeDocument('https://ignored.example/', RECT)
    controller.moveNativeDocument(RECT)
    expect(stub.open).not.toHaveBeenCalled()
    expect(stub.move).not.toHaveBeenCalled()
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
    expect(request.key).toBe('tab')
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
    const invalid: readonly BrowserCarrierRect[] = [
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

  it('requires every Desktop carrier method before enabling native rendering', () => {
    const store = createBrowserStore().create('browser-controller-native-partial-bridge-test')
    const { conversation } = conversationStub()
    const open = vi.fn(() => Promise.resolve())

    installBridge({ openBrowserDocument: open })
    expect(createBrowserControllers(store.actions, SESSION, conversation).nativeAvailable).toBe(false)

    installBridge({ openBrowserDocument: open, moveBrowserDocument: vi.fn(() => Promise.resolve()) })
    expect(createBrowserControllers(store.actions, SESSION, conversation).nativeAvailable).toBe(false)

    installBridge({
      openBrowserDocument: open,
      moveBrowserDocument: vi.fn(() => Promise.resolve()),
      closeBrowserDocument: vi.fn(() => Promise.resolve()),
    })
    expect(createBrowserControllers(store.actions, SESSION, conversation).nativeAvailable).toBe(false)

    installBridge({
      openBrowserDocument: open,
      moveBrowserDocument: vi.fn(() => Promise.resolve()),
      closeBrowserDocument: vi.fn(() => Promise.resolve()),
      onBrowserDocument: vi.fn(() => Promise.resolve(() => {})),
    })
    expect(createBrowserControllers(store.actions, SESSION, conversation).nativeAvailable).toBe(true)
  })

  it('opens, moves, and closes the native carrier for the held document', async () => {
    const stub = documentBridge()
    installBridge(stub.bridge)
    const store = createBrowserStore().create('browser-controller-native-lifecycle-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    face.loadUrl(TAB, 'https://example.test/one')
    expect(face.nativeAvailable).toBe(true)

    face.openNativeDocument(TAB, 'https://example.test/one', RECT)
    await settlePicker()
    expect(stub.open).toHaveBeenCalledWith({ key: NATIVE_KEY, url: 'https://example.test/one', ...RECT })
    expect(stub.listenerCount()).toBe(1)

    face.moveNativeDocument(TAB, MOVED)
    expect(stub.move).toHaveBeenCalledWith({ key: NATIVE_KEY, ...MOVED })

    face.closeNativeDocument(TAB)
    expect(stub.close).toHaveBeenCalledWith(NATIVE_KEY)
    expect(stub.listenerCount()).toBe(0)
    face.moveNativeDocument(TAB, MOVED)
    expect(stub.move).toHaveBeenCalledOnce()
  })

  it('ignores carrier commands without a document or a Desktop bridge', async () => {
    const stub = documentBridge()
    installBridge(stub.bridge)
    const store = createBrowserStore().create('browser-controller-native-absent-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)

    face.openNativeDocument(TAB, 'https://example.test/one', RECT)
    face.moveNativeDocument(TAB, RECT)
    await settlePicker()
    expect(stub.open).not.toHaveBeenCalled()

    face.loadUrl(TAB, 'https://example.test/one')
    installBridge({})
    face.openNativeDocument(TAB, 'https://example.test/one', RECT)
    face.moveNativeDocument(TAB, RECT)
    face.closeNativeDocument(TAB)
    await settlePicker()
    expect(stub.open).not.toHaveBeenCalled()
    expect(stub.move).not.toHaveBeenCalled()
    expect(stub.close).not.toHaveBeenCalled()
  })

  it('ignores a carrier move once the Desktop bridge disappears', async () => {
    const stub = documentBridge()
    installBridge(stub.bridge)
    const store = createBrowserStore().create('browser-controller-native-bridge-lost-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    face.loadUrl(TAB, 'https://example.test/one')
    face.openNativeDocument(TAB, 'https://example.test/one', RECT)
    await settlePicker()
    expect(stub.listenerCount()).toBe(1)

    installBridge({})
    face.moveNativeDocument(TAB, MOVED)
    expect(stub.move).not.toHaveBeenCalled()
  })

  it('reports a native load against the revision the carrier holds', async () => {
    const stub = documentBridge()
    installBridge(stub.bridge)
    const store = createBrowserStore().create('browser-controller-native-loaded-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    face.loadUrl(TAB, 'https://example.test/one')

    face.openNativeDocument(TAB, 'https://example.test/one', RECT)
    await settlePicker()
    expect(store.getSnapshot().byTab[TAB]?.navigation.status).toBe('loading')

    stub.emit({ key: NATIVE_KEY, status: 'loaded' })
    expect(store.getSnapshot().byTab[TAB]?.navigation.status).toBe('known')

    face.closeNativeDocument(TAB)
    stub.emit({ key: NATIVE_KEY, status: 'loaded' })
    expect(store.getSnapshot().byTab[TAB]?.navigation.status).toBe('known')
  })

  it('keeps the address readable across the URLs a native carrier commits', async () => {
    const stub = documentBridge()
    installBridge(stub.bridge)
    const store = createBrowserStore().create('browser-controller-native-committed-url-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    face.loadUrl(TAB, 'https://example.test/one')

    face.openNativeDocument(TAB, 'https://example.test/one', RECT)
    await settlePicker()
    stub.emit({ key: NATIVE_KEY, status: 'loaded', url: 'https://example.test/final' })
    expect(store.getSnapshot().byTab[TAB]?.navigation.status).toBe('known')
    expect(store.getSnapshot().byTab[TAB]?.entries[0]?.url).toBe('https://example.test/final')

    stub.emit({ key: NATIVE_KEY, status: 'loaded', url: 'https://example.test/final' })
    expect(store.getSnapshot().byTab[TAB]?.navigation.status).toBe('known')

    stub.emit({ key: NATIVE_KEY, status: 'loaded', url: `${APP}/page` })
    expect(store.getSnapshot().byTab[TAB]?.navigation.status).toBe('unknown')
  })

  it('opens a native popup target in the system browser', async () => {
    const stub = documentBridge()
    installBridge(stub.bridge)
    const open = vi.fn()
    vi.stubGlobal('open', open)
    const store = createBrowserStore().create('browser-controller-native-popup-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    face.loadUrl(TAB, 'https://example.test/one')

    face.openNativeDocument(TAB, 'https://example.test/one', RECT)
    await settlePicker()
    stub.emit({ key: NATIVE_KEY, status: 'popup', url: 'https://popup.example/' })
    expect(open).toHaveBeenCalledWith('https://popup.example/', '_blank', 'noopener,noreferrer')

    stub.emit({ key: NATIVE_KEY, status: 'popup' })
    expect(open).toHaveBeenCalledOnce()
  })

  it('ignores native carrier events from another tab or a torn-down controller', async () => {
    const stub = documentBridge()
    installBridge(stub.bridge)
    const store = createBrowserStore().create('browser-controller-native-foreign-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    face.loadUrl(TAB, 'https://example.test/one')

    face.openNativeDocument(TAB, 'https://example.test/one', RECT)
    await settlePicker()
    stub.emit({ key: 'other-tab', status: 'loaded' })
    expect(store.getSnapshot().byTab[TAB]?.navigation.status).toBe('loading')

    tabLifetime.abort()
    stub.emit({ key: NATIVE_KEY, status: 'loaded' })
    expect(stub.close).toHaveBeenCalledWith(NATIVE_KEY)
  })

  it('returns rendering to the iframe when the native carrier refuses to open', async () => {
    const stub = documentBridge()
    stub.open.mockRejectedValueOnce(new Error('carrier refused'))
    installBridge(stub.bridge)
    const store = createBrowserStore().create('browser-controller-native-open-failure-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    face.loadUrl(TAB, 'https://example.test/one')
    const frame = face.keyedHooks.browserFrame(TAB)!

    face.openNativeDocument(TAB, 'https://example.test/one', RECT)
    await settlePicker()
    expect(frame.getSnapshot().nativeFailed).toBe(true)
    expect(stub.listenerCount()).toBe(0)

    face.loadUrl(TAB, 'https://example.test/two')
    expect(frame.getSnapshot().nativeFailed).toBe(false)
  })

  it('ignores a carrier startup failure that was already superseded', async () => {
    const startup = deferred<undefined>()
    const stub = documentBridge()
    stub.open.mockImplementationOnce(() => startup.promise)
    installBridge(stub.bridge)
    const store = createBrowserStore().create('browser-controller-native-stale-failure-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    face.loadUrl(TAB, 'https://example.test/one')
    const frame = face.keyedHooks.browserFrame(TAB)!

    face.openNativeDocument(TAB, 'https://example.test/one', RECT)
    await settlePicker()
    face.closeNativeDocument(TAB)
    startup.reject(new Error('carrier closed'))
    await settlePicker()
    expect(frame.getSnapshot().nativeFailed).toBe(false)
  })

  it('unsubscribes when the document changes during carrier startup', async () => {
    const registration = deferred<() => void>()
    const unsubscribe = vi.fn()
    const open = vi.fn(() => Promise.resolve())
    installBridge({
      openBrowserDocument: open,
      moveBrowserDocument: vi.fn(() => Promise.resolve()),
      closeBrowserDocument: vi.fn(() => Promise.resolve()),
      onBrowserDocument: (_listener: (event: BrowserDocumentEvent) => void) => {
        return registration.promise.then(() => unsubscribe)
      },
    })
    const store = createBrowserStore().create('browser-controller-native-race-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    face.loadUrl(TAB, 'https://example.test/one')

    face.openNativeDocument(TAB, 'https://example.test/one', RECT)
    face.closeNativeDocument(TAB)
    registration.resolve(() => {})
    await settlePicker()

    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(open).not.toHaveBeenCalled()
  })

  it.each([false, true])('keeps the new carrier after a late open (navigate=%s)', async (navigate) => {
    vi.mocked(randomUUID).mockReturnValueOnce('00000000-0000-4000-8000-000000000001').mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
    const startup = deferred<undefined>()
    const stub = documentBridge()
    stub.open.mockImplementationOnce(() => startup.promise)
    installBridge(stub.bridge)
    const store = createBrowserStore().create('browser-controller-native-remount-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    face.mount(TAB, lifetime().signal, APP)
    face.loadUrl(TAB, 'https://example.test/one')
    face.openNativeDocument(TAB, 'https://example.test/one', RECT)
    await settlePicker()
    const oldKey = stub.open.mock.calls[0]![0].key
    face.closeNativeDocument(TAB)
    const nextUrl = navigate ? 'https://example.test/two' : 'https://example.test/one'
    if (navigate) face.loadUrl(TAB, nextUrl)
    face.openNativeDocument(TAB, nextUrl, RECT)
    await settlePicker()
    const newKey = stub.open.mock.calls[1]![0].key
    startup.resolve(undefined)
    await settlePicker()
    expect(newKey).not.toBe(oldKey)
    expect(stub.close).not.toHaveBeenCalledWith(newKey)
    expect(stub.listenerCount()).toBe(1)
    face.moveNativeDocument(TAB, MOVED)
    expect(stub.move).toHaveBeenLastCalledWith({ key: newKey, ...MOVED })
    stub.emit({ key: oldKey, status: 'loaded', url: 'https://stale.example/' })
    expect(store.getSnapshot().byTab[TAB]?.navigation.status).toBe('loading')
    stub.emit({ key: newKey, status: 'loaded' })
    expect(store.getSnapshot().byTab[TAB]?.navigation.status).toBe('known')
    await expect(JSON.stringify({
      activeListeners: stub.listenerCount(),
      activePage: store.getSnapshot().byTab[TAB]?.navigation.status,
      staleCarrierClosed: stub.close.mock.calls.some(([key]) => key === oldKey),
      activeCarrierClosed: stub.close.mock.calls.some(([key]) => key === newKey),
    }, null, 2) + '\n').toMatchFileSnapshot('./expected/native-carrier-race.json')
  })

  it('closes the native carrier when the tab occurrence ends during startup', async () => {
    const startup = deferred<undefined>()
    const stub = documentBridge()
    stub.open.mockImplementationOnce(() => startup.promise)
    installBridge(stub.bridge)
    const store = createBrowserStore().create('browser-controller-native-dispose-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    face.loadUrl(TAB, 'https://example.test/one')

    face.openNativeDocument(TAB, 'https://example.test/one', RECT)
    await settlePicker()
    tabLifetime.abort()
    startup.resolve(undefined)
    await settlePicker()
    expect(stub.close).toHaveBeenCalledWith(NATIVE_KEY)
  })

  it('tolerates carrier commands the Desktop shell already rejects', async () => {
    const stub = documentBridge()
    stub.close.mockRejectedValueOnce(new Error('carrier already closed'))
    stub.move.mockRejectedValueOnce(new Error('carrier already closed'))
    installBridge(stub.bridge)
    const store = createBrowserStore().create('browser-controller-native-rejection-test')
    const { conversation } = conversationStub()
    const face = createBrowserControllers(store.actions, SESSION, conversation)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    face.loadUrl(TAB, 'https://example.test/one')

    face.openNativeDocument(TAB, 'https://example.test/one', RECT)
    await settlePicker()
    face.moveNativeDocument(TAB, MOVED)
    face.closeNativeDocument(TAB)
    await settlePicker()
    expect(stub.move).toHaveBeenCalledOnce()
    expect(stub.close).toHaveBeenCalledOnce()
  })
})
