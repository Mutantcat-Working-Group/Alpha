/** URL, history, and observability state for one Browser tab. */
import { parseBrowserAddress } from './url.ts'
import type { BrowserAddressFailure, BrowserTarget } from './url.ts'

/** Maximum retained application-known navigation entries per tab. */
export const MAX_BROWSER_HISTORY = 100

/** One canonical address in the application-managed Web history. */
export type BrowserHistoryEntry = BrowserTarget

/** Whether the current carrier document still corresponds to an application-known URL. */
export type BrowserNavigationStatus =
  | { readonly status: 'empty' }
  | { readonly status: 'loading'; readonly revision: number }
  | { readonly status: 'known'; readonly revision: number }
  | { readonly status: 'unknown'; readonly revision: number }

/** Address-policy or loading failure shown below the toolbar. */
export type BrowserFailure =
  { readonly kind: 'address'; readonly reason: BrowserAddressFailure }

/** One Browser tab's serializable URL state. */
export interface BrowserTabState {
  readonly entries: readonly BrowserHistoryEntry[]
  readonly index: number
  /** Last application-directed load; carrier observations do not rewrite it. */
  readonly request: { readonly revision: number; readonly target: BrowserTarget } | undefined
  readonly navigation: BrowserNavigationStatus
  readonly failure: BrowserFailure | undefined
}

/**
 * Owns the application-known URL history and the carrier observation state machine.
 * The first load for a request keeps its URL authoritative; another iframe load marks it
 * unknown, while a native load carries the URL the carrier committed and replaces the
 * current entry's address with it.
 */
export class BrowserNavigation {
  private value: BrowserTabState

  /**
   * @param initial - persisted state restored for this tab, or a fresh empty state.
   * @param applicationOrigin - current DSH document origin, refused for observed URLs.
   */
  constructor(
    initial: BrowserTabState = BrowserNavigation.empty(),
    private readonly applicationOrigin?: string,
  ) {
    this.value = initial
  }

  /**
   * Create state before a tab has a controlled navigation target.
   * @returns empty serializable state.
   */
  static empty(): BrowserTabState {
    return { entries: [], index: -1, request: undefined, navigation: { status: 'empty' }, failure: undefined }
  }

  /**
   * Read the selected application-history entry.
   * @param state - serializable tab state.
   * @returns the current target, if any.
   */
  static current(state: BrowserTabState | undefined): BrowserHistoryEntry | undefined {
    return state === undefined || state.index < 0 ? undefined : state.entries[state.index]
  }

  /**
   * Test whether the Web carrier can use the preceding application-history entry.
   * @param state - serializable tab state.
   * @returns whether Back is available.
   */
  static canGoBack(state: BrowserTabState): boolean {
    return state.navigation.status !== 'unknown' && state.index > 0
  }

  /**
   * Test whether the Web carrier can use the following application-history entry.
   * @param state - serializable tab state.
   * @returns whether Forward is available.
   */
  static canGoForward(state: BrowserTabState): boolean {
    return state.navigation.status !== 'unknown'
      && state.index >= 0
      && state.index < state.entries.length - 1
  }

  /** Current immutable serializable state. */
  get snapshot(): BrowserTabState {
    return this.value
  }

  /** Whether the Web iframe can safely use the application-owned Back entry. */
  get canGoBack(): boolean {
    return BrowserNavigation.canGoBack(this.value)
  }

  /** Whether the Web iframe can safely use the application-owned Forward entry. */
  get canGoForward(): boolean {
    return BrowserNavigation.canGoForward(this.value)
  }

  /**
   * Add a controlled target and discard its stale forward branch.
   * @param target - validated canonical target.
   * @returns the new load request.
   */
  navigate(target: BrowserTarget): NonNullable<BrowserTabState['request']> {
    const entries = [...this.value.entries.slice(0, this.value.index + 1), target]
    if (entries.length > MAX_BROWSER_HISTORY) entries.splice(0, entries.length - MAX_BROWSER_HISTORY)
    return this.request(target, { ...this.value, entries, index: entries.length - 1 })
  }

  /**
   * Select the preceding application-known target.
   * @returns a new load request, or undefined when unavailable.
   */
  back(): BrowserTabState['request'] {
    if (!this.canGoBack) return undefined
    const index = this.value.index - 1
    const target = this.value.entries[index] as BrowserHistoryEntry
    return this.request(target, { ...this.value, index })
  }

  /**
   * Select the following application-known target.
   * @returns a new load request, or undefined when unavailable.
   */
  forward(): BrowserTabState['request'] {
    if (!this.canGoForward) return undefined
    const index = this.value.index + 1
    const target = this.value.entries[index] as BrowserHistoryEntry
    return this.request(target, { ...this.value, index })
  }

  /**
   * Start another load of the last application-known target.
   * @returns a new load request, or undefined before the first target.
   */
  reload(): BrowserTabState['request'] {
    const target = BrowserNavigation.current(this.value)
    return target === undefined ? undefined : this.request(target, this.value)
  }

  /**
   * Record an invalid address without changing the active document state.
   * @param reason - parser refusal.
   */
  addressFailed(reason: BrowserAddressFailure): void {
    this.value = { ...this.value, failure: { kind: 'address', reason } }
  }

  /**
   * Record a frame load for its captured revision.
   * @param revision - revision bound to the rendered frame.
   * @param url - URL a native carrier committed, when the carrier reports one.
   */
  frameLoaded(revision: number, url?: string): void {
    const navigation = this.value.navigation
    if (navigation.status === 'empty' || navigation.revision !== revision) return
    if (url !== undefined) {
      this.observed(url, revision)
      return
    }
    if (navigation.status === 'loading') {
      this.value = { ...this.value, navigation: { status: 'known', revision } }
    } else if (navigation.status === 'known') {
      this.value = { ...this.value, navigation: { status: 'unknown', revision } }
    }
  }

  /**
   * Settle a revision from the URL its carrier committed.
   *
   * A native carrier reports the URL of every finished load, including a redirect the
   * application did not request, so the load keeps the address readable and replaces the
   * selected entry's address with the committed one. An address the parser refuses leaves
   * the carrier unobservable.
   * @param url - URL the carrier committed.
   * @param revision - revision bound to the rendered frame.
   */
  private observed(url: string, revision: number): void {
    const parsed = parseBrowserAddress(url, this.applicationOrigin)
    if (!parsed.ok) {
      this.value = { ...this.value, navigation: { status: 'unknown', revision } }
      return
    }
    const index = this.value.index
    const entries = this.value.entries.map((entry, at) => (at === index ? parsed.target : entry))
    this.value = { ...this.value, entries, navigation: { status: 'known', revision } }
  }

  private request(
    target: BrowserTarget,
    basis: BrowserTabState,
  ): NonNullable<BrowserTabState['request']> {
    const request = { revision: (this.value.request?.revision ?? 0) + 1, target }
    this.value = {
      ...basis,
      request,
      navigation: { status: 'loading', revision: request.revision },
      failure: undefined,
    }
    return request
  }
}
