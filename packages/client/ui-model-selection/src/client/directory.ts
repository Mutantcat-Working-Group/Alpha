/**
 * Per-session model directory: the ONE state both selection entries share.
 * The /model popup and composer seat combine one shared Host catalog with the
 * Session's durable selection projection, then submit through the same
 * selectModel call. A switch made in either entry updates this shared state.
 */
import type {
  ModelCatalogFailure, ModelProviderGroup, ModelSelection, ModelSelectionProjection,
} from '@mutantcat/dsh-api-session-controller/types'
import type { SessionId } from '@mutantcat/dsh-api-remotes/client'
import type { RemoteResult, TypertClientRemote } from '@mutantcat/dsh-typert-protocol'
import type { ObservableSnapshot, SnapshotStore } from '@mutantcat/dsh-client-store'
import { createSnapshotStore } from '@mutantcat/dsh-client-store'
import type { ModelCatalogDirectory } from './catalog.ts'

/** Directory snapshot both entries render from. */
export interface ModelDirectoryState {
  /**
   * Effective selection: a selection the Host just accepted over the wire,
   * then the durable next-request projection, then the Host default, accepted
   * only while an adapter still serves its provider. null when none resolves,
   * or when the resolved provider is no longer routable, so a stale route
   * never renders as the current model.
   */
  current: ModelSelection | null
  /**
   * Whether an adapter serves the session's durable route, as the host reports
   * it — null before the first load, which is NOT the same as blocked, and null
   * when the session holds no durable selection at all. Read this rather than
   * "current matches no group": catalog membership is advisory, so a route
   * serving a model it stopped advertising is missing from the groups yet
   * perfectly usable. A durable selection whose provider no adapter serves
   * reports false — the composer blocks — even though `current` falls back to
   * null so the seat shows its neutral label instead of the stale id.
   */
  routable: boolean | null
  /** Successfully loaded provider groups (last good load). */
  groups: readonly ModelProviderGroup[]
  /** Provider-local failures from the last load; usable groups stay usable. */
  failures: readonly ModelCatalogFailure[]
  /** Lifecycle of the in-flight operation. */
  status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error'
  /** Whole-request or selection failure text; null when none. */
  error: string | null
}

/** One session's shared directory controller; disposed with the session scope. */
export class ModelDirectory {
  /** The shared snapshot both entries render from (uSES-safe store). */
  readonly store: SnapshotStore<ModelDirectoryState> = createSnapshotStore<ModelDirectoryState>({
    current: null, routable: null, groups: [], failures: [], status: 'idle', error: null,
  })

  /** Latest selection operation wins; an older response never overwrites a newer one. */
  private generation = 0
  private disposed = false
  private resolved = false
  /**
   * Selection the Host accepted over the wire, shown before the durable
   * projection reports it. The frame carrying the same value arrives later
   * and, on a push stream that lags, may not arrive at all; this stands in
   * until the projection catches up, then clears.
   */
  private confirmed: ModelSelection | null = null
  private readonly unsubscribeCatalog: () => void
  private readonly unsubscribeSelection: () => void

  /**
   * @param sessions - the session wire face (captured from the plugin's root connection).
   * @param sessionId - the owning session.
   * @param available - whether this session may use Agent-bound model RPCs.
   * @param catalog - Host-generation catalog shared by every Session.
   * @param projected - durable model selection projected from Session history.
   */
  constructor(
    private readonly sessions: Pick<TypertClientRemote['session'], 'selectModel'>,
    private readonly sessionId: SessionId,
    private readonly available: () => boolean,
    private readonly catalog: ModelCatalogDirectory,
    private readonly projected: ObservableSnapshot<unknown>,
  ) {
    this.unsubscribeCatalog = catalog.store.subscribe(() => { this.syncInputs() })
    this.unsubscribeSelection = projected.subscribe(() => { this.syncInputs() })
    this.syncInputs()
  }

  /**
   * Ensure the Host generation's shared advisory catalog is loaded.
   * @returns the fresh directory value.
   */
  async load(): Promise<ModelDirectoryState> {
    this.assertAvailable()
    await this.catalog.load()
    this.syncInputs()
    return this.store.getSnapshot()
  }

  /**
   * Select the complete provider/model/reasoning selection. The Host answers
   * with the selection it normalized and installed. That value becomes the
   * shared current immediately and is held until the durable projection
   * reports it, so a switch shows the moment the call resolves rather than
   * when the push stream catches up. Failures surface on the store and return
   * with the operation so each entry can present its own failure.
   * @param selection - provider, provider-owned model id, and optional adapter-owned effort.
   * @returns the selection outcome, including the original Remote failure.
   */
  async select(selection: ModelSelection): Promise<RemoteResult<void>> {
    this.assertAvailable()
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'selecting'; s.error = null })
    const result = await this.sessions.selectModel({
      sessionId: this.sessionId,
      provider: selection.provider,
      model: selection.model,
      ...selection.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: selection.reasoningEffort },
    })
    if (this.disposed || generation !== this.generation) {
      return result.ok ? { ok: true, value: undefined } : result
    }
    if (!result.ok) {
      this.store.update((s) => {
        s.status = 'error'
        s.error = `${result.error.code}: ${result.error.message}`
      })
      return result
    }
    this.confirmed = { ...result.value.selected }
    this.store.update((s) => { s.status = 'ready'; s.error = null })
    this.syncInputs()
    return { ok: true, value: undefined }
  }

  /**
   * Invalidate an in-flight selection response from the previous Host generation.
   */
  resetConnected(): void {
    if (this.disposed) return
    ++this.generation
    this.confirmed = null
    this.store.update((state) => {
      if (state.status === 'selecting') state.status = 'idle'
      state.error = null
    })
    this.syncInputs()
  }

  /** Scope teardown: late settlements lose write access to the store. */
  dispose(): void {
    this.disposed = true
    this.unsubscribeSelection()
    this.unsubscribeCatalog()
  }

  private assertAvailable(): void {
    if (!this.available()) {
      throw new Error('model selection is unavailable for addressed subagent sessions')
    }
  }

  private syncInputs(): void {
    if (this.disposed) return
    const catalog = this.catalog.store.getSnapshot()
    const projected = modelSelectionProjection(this.projected.getSnapshot())
    // The durable projection is the record of what the Session will request; a
    // wire confirmation stands in only until that record reports the same route.
    if (this.confirmed !== null && projected !== undefined
      && sameSelection(projected.next, this.confirmed)) {
      this.confirmed = null
    }
    const confirmed = this.confirmed
    if (catalog.status !== 'ready' || catalog.value === null || projected === undefined) {
      if (confirmed !== null) {
        // The Host resolved the route before it answered, so a confirmation is
        // routable without consulting a catalog that is still loading; it
        // renders over the last good groups instead of waiting for the refresh.
        this.resolved = true
        this.store.update((state) => {
          state.current = confirmed
          state.routable = true
          state.error = null
          if (state.status !== 'selecting') state.status = 'ready'
        })
        return
      }
      if (this.resolved) {
        if (catalog.status === 'error') {
          this.store.update((state) => {
            state.status = 'error'
            state.error = catalog.error
          })
        }
        return
      }
      this.store.set({
        current: null,
        routable: null,
        groups: [],
        failures: [],
        status: catalog.status === 'error' ? 'error' : 'loading',
        error: catalog.error,
      })
      return
    }
    // The durable selection is authoritative only while its provider is still
    // served. A route left over from an earlier configuration must not surface
    // as the current model — the seat would name a provider the user never
    // configured — yet it still marks the session unroutable so the composer
    // keeps its select-a-model block instead of accepting a doomed send.
    const catalogValue = catalog.value
    const routableProviders = new Set(catalogValue.routableProviders)
    const durable = confirmed ?? projected.next ?? catalogValue.default
    const current = durable !== null && routableProviders.has(durable.provider) ? durable : null
    const status = this.store.getSnapshot().status === 'selecting' ? 'selecting' : 'ready'
    this.resolved = true
    this.store.set({
      current,
      routable: durable === null ? null : current !== null,
      groups: catalogValue.groups,
      failures: catalogValue.failures,
      status,
      error: null,
    })
  }
}

function modelSelectionProjection(value: unknown): ModelSelectionProjection | undefined {
  return value === undefined ? undefined : value as ModelSelectionProjection
}

/**
 * Whether two selections name the same route and effort.
 * @param left - first selection, or null for none.
 * @param right - second selection, or null for none.
 * @returns true when both are null, or both name the same provider, model, and effort.
 */
function sameSelection(left: ModelSelection | null, right: ModelSelection | null): boolean {
  return left === right || (left !== null && right !== null
    && left.provider === right.provider
    && left.model === right.model
    && left.reasoningEffort === right.reasoningEffort)
}
