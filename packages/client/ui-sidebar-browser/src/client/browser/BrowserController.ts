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
export interface ComponentPickerRect {
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

/* jscpd:ignore-start -- per-consumer copy of the `dshDesktopBoot` seam that
   session-log-export and ui-settings-import-sessions own; each plugin bundles
   independently and carries only the methods it calls. */
/** Native component-picker methods every Desktop document boot bridge carries. */
interface ComponentPickerBridge {
  readonly startComponentPicker: (request: {
    readonly requestId: string
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
interface DesktopPickerBridge {
  dshDesktopBoot?: Partial<ComponentPickerBridge>
}

/** Resolve the Desktop component picker, or `undefined` in a plain browser. */
function componentPickerBridge(): ComponentPickerBridge | undefined {
  const bridge = (globalThis as DesktopPickerBridge).dshDesktopBoot
  const startComponentPicker = bridge?.startComponentPicker
  const cancelComponentPicker = bridge?.cancelComponentPicker
  const onComponentPicker = bridge?.onComponentPicker
  if (startComponentPicker === undefined) return undefined
  if (cancelComponentPicker === undefined) return undefined
  if (onComponentPicker === undefined) return undefined
  return { startComponentPicker, cancelComponentPicker, onComponentPicker }
}
/* jscpd:ignore-end */

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
  private disposed = false

  /**
   * @param options - tab identity, persistence writer, URL origin, and lifetime.
   */
  constructor(private readonly options: BrowserControllerOptions) {
    this.navigation = new BrowserNavigation(options.initial)
    this.frame = new IframeImpl(
      () => { this.reload() },
      (revision) => { this.frameLoaded(revision) },
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
  startPicker(rect: ComponentPickerRect): boolean {
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
    void this.pick(bridge, requestId, rect, document.target.url)
    return true
  }

  /**
   * Subscribe before opening the child webview, so a cancel that arrives
   * during startup cannot outrun the listener that consumes it.
   */
  private async pick(
    bridge: ComponentPickerBridge,
    requestId: string,
    rect: ComponentPickerRect,
    url: string,
  ): Promise<void> {
    try {
      const unsubscribe = await bridge.onComponentPicker((result) => { this.pickerResult(result) })
      if (this.pickerDisposed || this.pickerRequestId !== requestId) {
        unsubscribe()
        return
      }
      this.pickerUnsubscribe = unsubscribe
      await bridge.startComponentPicker({ requestId, url, ...rect })
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

  private frameLoaded(revision: number): void {
    if (this.disposed) return
    const previous = this.navigation.snapshot
    this.navigation.frameLoaded(revision)
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

  private dispose(): void {
    this.disposed = true
    this.stopPicker()
    this.pickerDisposed = true
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
  startPicker(tabId: TabId, rect: ComponentPickerRect): boolean
  /** @param tabId - tab occurrence. */
  stopPicker(tabId: TabId): void
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
    loadUrl: (tabId, value) => { controller(tabId)?.loadUrl(value) },
    goBack: (tabId) => { controller(tabId)?.goBack() },
    goForward: (tabId) => { controller(tabId)?.goForward() },
    reload: (tabId) => { controller(tabId)?.reload() },
    toggleSandbox: (tabId) => { controller(tabId)?.frame.toggleSandbox() },
    reportLoaded: (tabId, revision) => { controller(tabId)?.frame.reportLoaded(revision) },
    reportLoadFailed: (tabId, revision) => { controller(tabId)?.frame.reportLoadFailed(revision) },
  }
}
