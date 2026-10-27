/** Per-tab Browser controller. */
import type { BoundActions } from '@mutantcat/dsh-client-store'
import type { TabId } from '@mutantcat/dsh-client-ui-dockkit'
import type { HostObservable } from '@mutantcat/dsh-client-ui-slots'
import type { SessionId } from '@mutantcat/dsh-session/types'
import { randomUUID } from '@mutantcat/dsh-util-crypto'
import type { BrowserTarget } from './url.ts'
import type { IConversation } from '@mutantcat/dsh-client-ui-conversation/client'
import { IframeImpl } from './BrowserFrame.ts'
import type { BrowserFrame, BrowserFrameState } from './BrowserFrame.ts'
import { BrowserNavigation } from './BrowserNavigation.ts'
import type { BrowserTabState } from './BrowserNavigation.ts'
import type { BrowserStore } from './store.ts'
import { parseBrowserAddress } from './url.ts'

/** Construction dependencies for one tab-scoped Browser controller. */
export interface BrowserControllerOptions {
  readonly tabId: TabId
  readonly sessionId: SessionId
  readonly signal: AbortSignal
  readonly applicationOrigin: string
  readonly initial?: BrowserTabState
  readonly actions: BoundActions<BrowserStore>
  readonly conversation: IConversation
}

/** Bounding rectangle of the Browser iframe in logical CSS pixels. */
export interface BrowserCarrierRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** One result emitted by the Desktop component picker. */
export interface ComponentPickerResult {
  readonly requestId: string
  readonly status: 'selected' | 'cancelled' | 'error'
  readonly text?: string
  readonly message?: string
}

/** One request to open a native Browser document carrier. */
export interface BrowserDocumentOpenRequest {
  readonly key: string
  readonly url: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** One request to reposition an open native Browser document carrier. */
export interface BrowserDocumentMoveRequest {
  readonly key: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** One event a native Browser document reports to the Web client. */
export interface BrowserDocumentEvent {
  readonly key: string
  readonly status: 'loaded' | 'popup'
  readonly url?: string
}

/* jscpd:ignore-start -- per-consumer copy of the `dshDesktopBoot` seam that
   session-log-export and ui-settings-import-sessions own; each plugin bundles
   independently and carries only the methods it calls. */
/** Native component-picker methods every Desktop document boot bridge carries. */
interface ComponentPickerBridge {
  readonly startComponentPicker: (request: {
    readonly requestId: string
    readonly key: string
    readonly url: string
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }) => Promise<void>
  readonly cancelComponentPicker: (requestId: string) => Promise<void>
  readonly onComponentPicker: (listener: (result: ComponentPickerResult) => void) => Promise<() => void>
}

/** Desktop boot seam; every method is installed together in the shell. */
interface DesktopBrowserDocumentBridge {
  readonly openBrowserDocument: (request: BrowserDocumentOpenRequest) => Promise<void>
  readonly moveBrowserDocument: (request: BrowserDocumentMoveRequest) => Promise<void>
  readonly closeBrowserDocument: (key: string) => Promise<void>
  readonly onBrowserDocument: (listener: (event: BrowserDocumentEvent) => void) => Promise<() => void>
}

/** Desktop boot seam; every method is installed together in the shell. */
interface DesktopBootBridge {
  dshDesktopBoot?: Partial<ComponentPickerBridge & DesktopBrowserDocumentBridge>
}

/** Resolve the Desktop component picker, or `undefined` in a plain browser. */
function componentPickerBridge(): ComponentPickerBridge | undefined {
  const bridge = (globalThis as DesktopBootBridge).dshDesktopBoot
  const startComponentPicker = bridge?.startComponentPicker
  const cancelComponentPicker = bridge?.cancelComponentPicker
  const onComponentPicker = bridge?.onComponentPicker
  if (startComponentPicker === undefined) return undefined
  if (cancelComponentPicker === undefined) return undefined
  if (onComponentPicker === undefined) return undefined
  return { startComponentPicker, cancelComponentPicker, onComponentPicker }
}

/** Resolve the Desktop Browser document carrier, or `undefined` in a plain browser. */
function browserDocumentBridge(): DesktopBrowserDocumentBridge | undefined {
  const bridge = (globalThis as DesktopBootBridge).dshDesktopBoot
  const openBrowserDocument = bridge?.openBrowserDocument
  const moveBrowserDocument = bridge?.moveBrowserDocument
  const closeBrowserDocument = bridge?.closeBrowserDocument
  const onBrowserDocument = bridge?.onBrowserDocument
  if (openBrowserDocument === undefined) return undefined
  if (moveBrowserDocument === undefined) return undefined
  if (closeBrowserDocument === undefined) return undefined
  if (onBrowserDocument === undefined) return undefined
  return { openBrowserDocument, moveBrowserDocument, closeBrowserDocument, onBrowserDocument }
}
/* jscpd:ignore-end */

/** Native carrier registry key for one tab occurrence. */
function documentKey(tabId: TabId): string {
  return String(tabId)
}

function pickerFilename(document: { readonly target: BrowserTarget } | undefined): string {
  /* v8 ignore next -- a picker request ends before navigation can clear its document. */
  if (document === undefined) return 'component.txt'
  const host = new URL(document.target.url).hostname.replace(/[^a-zA-Z0-9.-]+/g, '-')
  return `${host}.txt`
}

/** Owns one Browser tab's URL state, loading lifecycle, and four navigation commands. */
export class BrowserController {
  /** Renderer-facing iframe and sandbox state. */
  readonly frame: BrowserFrame
  private readonly navigation: BrowserNavigation
  private pickerRequestId: string | undefined
  private pickerUnsubscribe: (() => void) | undefined
  private pickerDisposed = false
  /** Revision currently held by the native carrier, or `undefined` when none is. */
  private nativeRevision: number | undefined
  private nativeKey: string | undefined
  private nativeUnsubscribe: (() => void) | undefined
  private disposed = false

  /**
   * @param options - tab identity, persistence writer, URL origin, and lifetime.
   */
  constructor(private readonly options: BrowserControllerOptions) {
    this.navigation = new BrowserNavigation(options.initial, options.applicationOrigin)
    this.frame = new IframeImpl(
      () => { this.reload() },
      (revision, url) => { this.frameLoaded(revision, url) },
    )
    options.signal.addEventListener('abort', () => { this.dispose() }, { once: true })
  }

  /**
   * Validate and load one address, replacing a same-address load with Reload.
   * @param value - address-bar or typed-tab value.
   */
  loadUrl(value: string): void {
    if (this.disposed) return
    const parsed = parseBrowserAddress(value, this.options.applicationOrigin)
    if (!parsed.ok) {
      this.navigation.addressFailed(parsed.reason)
      this.publish()
      return
    }
    const current = BrowserNavigation.current(this.navigation.snapshot)
    if (current?.url === parsed.target.url) {
      this.reload()
      return
    }
    this.start(this.navigation.navigate(parsed.target))
  }

  /** Move to the preceding application-known address when Web history remains usable. */
  goBack(): void {
    if (this.disposed) return
    const request = this.navigation.back()
    if (request !== undefined) this.start(request)
  }

  /** Move to the following application-known address when Web history remains usable. */
  goForward(): void {
    if (this.disposed) return
    const request = this.navigation.forward()
    if (request !== undefined) this.start(request)
  }

  /** Reload the last application-known address without adding history. */
  reload(): void {
    if (this.disposed) return
    const request = this.navigation.reload()
    if (request !== undefined) this.start(request)
  }

  /**
   * Start native component picking over the current iframe.
   * @param rect - iframe bounds in the application document's CSS pixels.
   * @returns whether the picker entered its active state.
   */
  startPicker(rect: BrowserCarrierRect): boolean {
    if (this.disposed || this.frame.getSnapshot().picker === 'active') return false
    const document = this.frame.getSnapshot().document
    if (document === undefined) return false
    if (!(rect.x >= 0) || !(rect.y >= 0)) return false
    if (!(rect.width > 0) || !(rect.height > 0)) return false
    if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y)) return false
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return false
    const bridge = componentPickerBridge()
    if (bridge === undefined) return false
    const requestId = randomUUID()
    this.pickerRequestId = requestId
    this.frame.startPicker()
    void this.pick(bridge, requestId, rect, document.target.url, this.nativeKey ?? documentKey(this.options.tabId))
    return true
  }

  /**
   * Subscribe before opening the child webview, so a cancel that arrives
   * during startup cannot outrun the listener that consumes it.
   * @param key - native carrier registry key identifying the webview that picks.
   */
  private async pick(
    bridge: ComponentPickerBridge,
    requestId: string,
    rect: BrowserCarrierRect,
    url: string,
    key: string,
  ): Promise<void> {
    try {
      const unsubscribe = await bridge.onComponentPicker((result) => { this.pickerResult(result) })
      if (this.pickerDisposed || this.pickerRequestId !== requestId) {
        unsubscribe()
        return
      }
      this.pickerUnsubscribe = unsubscribe
      await bridge.startComponentPicker({ requestId, url, key, ...rect })
    } catch {
      this.failPicker(requestId)
    }
  }

  /** Leave component-picker mode and close the native child webview. */
  stopPicker(): void {
    const requestId = this.pickerRequestId
    this.clearPicker()
    if (requestId === undefined) return
    void componentPickerBridge()?.cancelComponentPicker(requestId).catch(() => {})
  }

  private start(request: NonNullable<BrowserTabState['request']>): void {
    this.stopPicker()
    this.publish()
    this.frame.clearDocument()
    this.frame.setDocument({ target: request.target, src: request.target.url, revision: request.revision })
  }

  /**
   * @param revision - revision bound to the rendered frame.
   * @param url - URL a native carrier committed, when the carrier reports one.
   */
  private frameLoaded(revision: number, url?: string): void {
    if (this.disposed) return
    const previous = this.navigation.snapshot
    this.navigation.frameLoaded(revision, url)
    if (this.navigation.snapshot !== previous) this.publish()
  }

  private publish(): void {
    this.options.actions.replace(this.options.tabId, this.navigation.snapshot)
  }

  private pickerResult(result: ComponentPickerResult): void {
    if (result.requestId !== this.pickerRequestId) return
    const requestId = result.requestId
    if (result.status === 'cancelled') {
      this.clearPicker()
      return
    }
    if (result.status === 'error' || typeof result.text !== 'string') {
      this.failPicker(requestId)
      return
    }
    if (!this.options.conversation.attachTextDocument(
      this.options.sessionId,
      pickerFilename(this.frame.getSnapshot().document),
      result.text,
    )) {
      this.failPicker(requestId)
      return
    }
    this.clearPicker()
  }

  private failPicker(requestId: string): void {
    if (this.pickerRequestId !== requestId) return
    this.clearPicker()
    this.frame.failPicker()
  }

  private clearPicker(): void {
    this.pickerRequestId = undefined
    this.pickerUnsubscribe?.()
    this.pickerUnsubscribe = undefined
    this.frame.stopPicker()
  }

  /**
   * Render the current document in the native carrier, or fall back to the iframe.
   *
   * A top-level child webview is not subject to the framing refusals that leave an
   * iframe carrier blank, so the Desktop shell renders the document natively.
   * @param url - prepared document URL.
   * @param rect - carrier rectangle in the application document's CSS pixels.
   */
  openNativeDocument(url: string, rect: BrowserCarrierRect): void {
    if (this.disposed) return
    const document = this.frame.getSnapshot().document
    if (document === undefined) return
    const bridge = browserDocumentBridge()
    if (bridge === undefined) return
    this.closeNativeDocument()
    const key = `${documentKey(this.options.tabId)}:${randomUUID()}`
    this.nativeKey = key
    this.nativeRevision = document.revision
    void this.openDocument(bridge, url, rect, key)
  }

  /**
   * Reposition the open native carrier over a changed rectangle.
   *
   * Disposal clears the held revision, so a disposed controller never reaches the bridge.
   * @param rect - carrier rectangle in the application document's CSS pixels.
   */
  moveNativeDocument(rect: BrowserCarrierRect): void {
    const key = this.nativeKey
    if (key === undefined) return
    const bridge = browserDocumentBridge()
    if (bridge === undefined) return
    void bridge.moveBrowserDocument({ key, ...rect }).catch(() => {})
  }

  /** Close the native carrier and stop consuming its events. */
  closeNativeDocument(): void {
    const key = this.nativeKey
    this.nativeKey = undefined
    this.nativeRevision = undefined
    const unsubscribe = this.nativeUnsubscribe
    this.nativeUnsubscribe = undefined
    unsubscribe?.()
    if (key !== undefined) void browserDocumentBridge()?.closeBrowserDocument(key).catch(() => {})
  }

  /**
   * Whether one open request still owns the native carrier.
   *
   * Every open has its own key, including remounts of the same revision. A superseded request
   * must neither report loads nor keep its child webview open.
   */
  private holdsCarrier(key: string): boolean {
    return !this.disposed && this.nativeKey === key
  }

  /**
   * Subscribe before opening the child webview, so a load reported during startup
   * cannot outrun the listener that consumes it.
   */
  private async openDocument(
    bridge: DesktopBrowserDocumentBridge,
    url: string,
    rect: BrowserCarrierRect,
    key: string,
  ): Promise<void> {
    try {
      const unsubscribe = await bridge.onBrowserDocument((event) => { this.documentEvent(event) })
      if (!this.holdsCarrier(key)) {
        unsubscribe()
        return
      }
      this.nativeUnsubscribe?.()
      this.nativeUnsubscribe = unsubscribe
      await bridge.openBrowserDocument({ key, url, ...rect })
      if (!this.holdsCarrier(key)) await bridge.closeBrowserDocument(key)
    } catch {
      if (!this.holdsCarrier(key)) return
      this.closeNativeDocument()
      this.frame.failNative()
    }
  }

  /**
   * Route one native carrier event to the load state machine or the system browser.
   *
   * Every path that clears `nativeRevision` also drops the subscription, so a delivered
   * event implies a live carrier; the guards below defend only a bridge that delivers
   * after its unsubscribe.
   */
  private documentEvent(event: BrowserDocumentEvent): void {
    /* v8 ignore next -- defensive: closeNativeDocument() drops this subscription on dispose. */
    if (this.disposed) return
    if (event.key !== this.nativeKey) return
    if (event.status === 'loaded') {
      const revision = this.nativeRevision
      /* v8 ignore next -- defensive: every path that clears nativeRevision also drops the subscription. */
      if (revision === undefined) return
      this.frame.reportLoaded(revision, event.url)
      return
    }
    if (event.url === undefined) return
    window.open(event.url, '_blank', 'noopener,noreferrer')
  }

  private dispose(): void {
    this.disposed = true
    this.stopPicker()
    this.pickerDisposed = true
    this.closeNativeDocument()
    this.frame.clearDocument()
  }
}

/** Browser commands and keyed frame state injected into the tab body. */
export interface BrowserInjected {
  readonly keyedHooks: {
    readonly browserFrame: (key: string) => HostObservable<BrowserFrameState> | undefined
  }
  /** Whether the Desktop shell exposes component picking; `false` in a plain browser. */
  readonly pickerAvailable: boolean
  /** Whether the Desktop shell renders documents in a native carrier; `false` in a plain browser. */
  readonly nativeAvailable: boolean
  /**
   * @param tabId - tab occurrence.
   * @param signal - occurrence lifetime.
   * @param applicationOrigin - current application origin.
   * @param initial - persisted tab state.
   */
  mount(tabId: TabId, signal: AbortSignal, applicationOrigin: string, initial?: BrowserTabState): void
  /**
   * Start native component picking over the current iframe.
   * @param tabId - tab occurrence.
   * @param rect - iframe bounds in logical CSS pixels.
   * @returns whether picker mode entered its active state.
   */
  startPicker(tabId: TabId, rect: BrowserCarrierRect): boolean
  /** @param tabId - tab occurrence. */
  stopPicker(tabId: TabId): void
  /**
   * Render one tab's current document in the native carrier.
   * @param tabId - tab occurrence.
   * @param url - prepared document URL.
   * @param rect - carrier rectangle in logical CSS pixels.
   */
  openNativeDocument(tabId: TabId, url: string, rect: BrowserCarrierRect): void
  /**
   * Reposition one tab's native carrier.
   * @param tabId - tab occurrence.
   * @param rect - carrier rectangle in logical CSS pixels.
   */
  moveNativeDocument(tabId: TabId, rect: BrowserCarrierRect): void
  /** @param tabId - tab occurrence. */
  closeNativeDocument(tabId: TabId): void
  /** @param tabId - tab occurrence. @param value - address-bar or typed-open value. */
  loadUrl(tabId: TabId, value: string): void
  /** @param tabId - tab occurrence. */
  goBack(tabId: TabId): void
  /** @param tabId - tab occurrence. */
  goForward(tabId: TabId): void
  /** @param tabId - tab occurrence. */
  reload(tabId: TabId): void
  /** @param tabId - tab occurrence. */
  toggleSandbox(tabId: TabId): void
  /** @param tabId - tab occurrence. @param revision - rendered document revision. */
  reportLoaded(tabId: TabId, revision: number): void
  /** @param tabId - tab occurrence. @param revision - rendered document revision that emitted `error`. */
  reportLoadFailed(tabId: TabId, revision: number): void
}

/**
 * Bind Browser controllers to one Session and its persistence writer.
 * @param actions - Browser store mutation face.
 * @param sessionId - Session that owns the Browser tabs.
 * @param conversation - Conversation service that receives picked component documents.
 * @returns a per-tab controller registry exposed as plain Slot callbacks.
 */
export function createBrowserControllers(
  actions: BoundActions<BrowserStore>,
  sessionId: SessionId,
  conversation: IConversation,
): BrowserInjected {
  const controllers = new Map<TabId, { readonly signal: AbortSignal; readonly controller: BrowserController }>()
  const controller = (tabId: TabId): BrowserController | undefined => controllers.get(tabId)?.controller
  return {
    pickerAvailable: componentPickerBridge() !== undefined,
    nativeAvailable: browserDocumentBridge() !== undefined,
    keyedHooks: { browserFrame: key => controller(key as TabId)?.frame },
    mount(tabId, signal, applicationOrigin, initial) {
      const held = controllers.get(tabId)
      if (held?.signal === signal) return
      const created = new BrowserController({
        tabId, sessionId, signal, applicationOrigin, actions, conversation,
        ...(initial === undefined ? {} : { initial }),
      })
      controllers.set(tabId, { signal, controller: created })
      signal.addEventListener('abort', () => {
        if (controllers.get(tabId)?.controller !== created) return
        controllers.delete(tabId)
        actions.forget(tabId)
      }, { once: true })
    },
    startPicker: (tabId, rect) => controller(tabId)?.startPicker(rect) ?? false,
    stopPicker: (tabId) => { controller(tabId)?.stopPicker() },
    openNativeDocument: (tabId, url, rect) => { controller(tabId)?.openNativeDocument(url, rect) },
    moveNativeDocument: (tabId, rect) => { controller(tabId)?.moveNativeDocument(rect) },
    closeNativeDocument: (tabId) => { controller(tabId)?.closeNativeDocument() },
    loadUrl: (tabId, value) => { controller(tabId)?.loadUrl(value) },
    goBack: (tabId) => { controller(tabId)?.goBack() },
    goForward: (tabId) => { controller(tabId)?.goForward() },
    reload: (tabId) => { controller(tabId)?.reload() },
    toggleSandbox: (tabId) => { controller(tabId)?.frame.toggleSandbox() },
    reportLoaded: (tabId, revision) => { controller(tabId)?.frame.reportLoaded(revision) },
    reportLoadFailed: (tabId, revision) => { controller(tabId)?.frame.reportLoadFailed(revision) },
  }
}
