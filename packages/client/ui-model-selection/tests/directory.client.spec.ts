/**
 * ModelDirectory's shared state: what "switch now" applies to. The Host
 * reports a parked turn as `running=false, paused=true`, so a park is live
 * activity the directory must not read as an idle Session.
 */
import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@mutantcat/dsh-session/types'
import type { ModelCatalog } from '@mutantcat/dsh-api-session-controller/types'
import type { SessionSnapshot } from '@mutantcat/dsh-api-session-controller/client'
import type { TypertClientRemote } from '@mutantcat/dsh-typert-protocol'
import { createSnapshotStore, type SnapshotStore } from '@mutantcat/dsh-client-store'
import { sessionSnapshot } from '@mutantcat/dsh-client-test-runtime'
import { ModelCatalogDirectory } from '../src/client/catalog.ts'
import { ModelDirectory } from '../src/client/directory.ts'

/** The one session verb the directory uses. */
type SessionWire = Pick<TypertClientRemote['session'], 'selectModel'>

const SESSION = SessionId('session-1')
const FLASH = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
const PRO = { provider: 'deepseek-official', model: 'deepseek-v4-pro' }

const CATALOG: ModelCatalog = {
  default: null,
  routableProviders: ['deepseek-official'],
  groups: [{
    id: 'deepseek-official',
    name: 'DeepSeek',
    models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' },
      { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
    ],
  }],
  failures: [],
}

/** A catalog already resolved for the current Host generation. */
function readyCatalog(): ModelCatalogDirectory {
  const catalog = new ModelCatalogDirectory({} as never)
  catalog.store.set({ value: CATALOG, status: 'ready', error: null })
  return catalog
}

/** A durable fold whose next request differs from the one the turn used. */
function supersededFold(): SnapshotStore<unknown> {
  return createSnapshotStore<unknown>({ lastUsed: FLASH, next: PRO })
}

/** A live Session snapshot; `over` sets the Agent lifecycle bits. */
function liveSession(over: Partial<SessionSnapshot>): SnapshotStore<SessionSnapshot> {
  return createSnapshotStore<SessionSnapshot>({ ...sessionSnapshot(SESSION), ...over })
}

function directory(
  projected: SnapshotStore<unknown>,
  live: SnapshotStore<SessionSnapshot>,
): ModelDirectory {
  const sessions = {
    selectModel: vi.fn(async () => ({ ok: true as const, value: { selected: PRO } })),
  } as unknown as SessionWire
  return new ModelDirectory(
    sessions,
    SESSION,
    () => true,
    readyCatalog(),
    projected,
    live,
  )
}

describe('ModelDirectory switchPending', () => {
  it('offers the cut while the turn runs with a superseded selection', () => {
    const dir = directory(supersededFold(), liveSession({ running: true }))
    expect(dir.store.getSnapshot().switchPending).toBe(true)
  })

  it('offers the cut while the turn is parked with a superseded selection', () => {
    // A parked turn is still generating: its in-flight work keeps going and
    // the fold still holds a selection it has not used, so the row stays.
    const dir = directory(supersededFold(), liveSession({ paused: true }))
    expect(dir.store.getSnapshot().switchPending).toBe(true)
  })

  it('offers no cut once the turn stops', () => {
    const live = liveSession({ running: true })
    const dir = directory(supersededFold(), live)
    expect(dir.store.getSnapshot().switchPending).toBe(true)
    // The turn ending is what removes the row: the next request takes the
    // selection on its own.
    live.set({ ...sessionSnapshot(SESSION) })
    expect(dir.store.getSnapshot().switchPending).toBe(false)
    dir.dispose()
  })

  it('offers no cut once the fold matches what the turn used', () => {
    const aligned = createSnapshotStore<unknown>({ lastUsed: PRO, next: PRO })
    const dir = directory(aligned, liveSession({ paused: true }))
    expect(dir.store.getSnapshot().switchPending).toBe(false)
  })

  it('tracks a park that arrives after the fold was already superseded', () => {
    const live = liveSession({ running: true })
    const dir = directory(supersededFold(), live)
    expect(dir.store.getSnapshot().switchPending).toBe(true)
    live.set({ ...sessionSnapshot(SESSION), paused: true })
    expect(dir.store.getSnapshot().switchPending).toBe(true)
    dir.dispose()
  })
})
