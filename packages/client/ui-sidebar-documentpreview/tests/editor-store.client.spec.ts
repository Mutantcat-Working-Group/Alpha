/**
 * The editor store's write set: one bucket per tab holding the loaded text, its
 * version, and the dirty/saving flags the strip renders; `kept` adopts a new
 * revision without dropping unsaved edits, `discarded` abandons them after a
 * refused save, and `forget` closes a tab.
 */
import { describe, expect, it } from 'vitest'
import { createEditorStore } from '../src/client/editor/store.ts'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'

const TAB_1 = 'tab-1' as TabId
const TAB_2 = 'tab-2' as TabId
const TAB_9 = 'tab-9' as TabId

const STALE = { code: 'workspace-file/stale-version', message: 'changed on disk' }

describe('editor store', () => {
  it('starts empty', () => {
    const instance = createEditorStore().create()
    expect(instance.getSnapshot().byTab).toEqual({})
  })

  it('mints a loading bucket with loadId zero and reuses the loadId of a previous read', () => {
    const instance = createEditorStore().create()
    instance.actions.loading(TAB_1, 1)
    expect(instance.getSnapshot().byTab[TAB_1]).toEqual({ revision: 1, loadId: 0, dirty: false, saving: false })
    instance.actions.complete(TAB_1, 1, 'const answer = 42', 'v1')
    instance.actions.dirtied(TAB_1, true)
    instance.actions.loading(TAB_1, 2)
    expect(instance.getSnapshot().byTab[TAB_1]).toEqual({ revision: 2, loadId: 1, dirty: false, saving: false })
  })

  it('settles a read with a fresh loadId, so a reload never reuses the previous document', () => {
    const instance = createEditorStore().create()
    instance.actions.loading(TAB_1, 1)
    instance.actions.complete(TAB_1, 1, 'first', 'v1')
    instance.actions.loading(TAB_1, 2)
    instance.actions.complete(TAB_1, 2, 'second', 'v2')
    expect(instance.getSnapshot().byTab[TAB_1]).toEqual({
      revision: 2, loadId: 2, text: 'second', version: 'v2', dirty: false, saving: false,
    })
  })

  it('records a read failure beside no text and clears it when a read settles', () => {
    const instance = createEditorStore().create()
    instance.actions.loading(TAB_1, 1)
    instance.actions.failed(TAB_1, 1, { code: 'workspace-file/not-found', message: 'gone' })
    expect(instance.getSnapshot().byTab[TAB_1]).toEqual({
      revision: 1, loadId: 0, failure: { code: 'workspace-file/not-found', message: 'gone' }, dirty: false, saving: false,
    })
    instance.actions.complete(TAB_1, 1, 'first', 'v1')
    expect(instance.getSnapshot().byTab[TAB_1]?.failure).toBeUndefined()
  })

  it('reports a failure on a tab that never read at loadId zero', () => {
    const instance = createEditorStore().create()
    instance.actions.failed(TAB_1, 1, { code: 'workspace-file/not-found', message: 'gone' })
    expect(instance.getSnapshot().byTab[TAB_1]).toEqual({
      revision: 1, loadId: 0, failure: { code: 'workspace-file/not-found', message: 'gone' }, dirty: false, saving: false,
    })
  })

  it('adopts a newer revision under unsaved edits and keeps the text, version, and dirty flag', () => {
    const instance = createEditorStore().create()
    instance.actions.complete(TAB_1, 1, 'const answer = 42', 'v1')
    instance.actions.dirtied(TAB_1, true)
    instance.actions.kept(TAB_1, 2)
    expect(instance.getSnapshot().byTab[TAB_1]).toEqual({
      revision: 2, loadId: 1, text: 'const answer = 42', version: 'v1', dirty: true, saving: false,
    })
  })

  it('ignores kept, discarded, dirtied, and the save actions for a tab that holds nothing', () => {
    const instance = createEditorStore().create()
    instance.actions.kept(TAB_9, 2)
    instance.actions.discarded(TAB_9)
    instance.actions.dirtied(TAB_9, true)
    instance.actions.saving(TAB_9)
    instance.actions.saved(TAB_9, 'x', 'v2')
    instance.actions.saveFailed(TAB_9, STALE)
    expect(instance.getSnapshot().byTab[TAB_9]).toBeUndefined()
  })

  it('abandons the text and version on discard but keeps the loadId, so the retained document is not reused', () => {
    const instance = createEditorStore().create()
    instance.actions.complete(TAB_1, 1, 'const answer = 42', 'v1')
    instance.actions.dirtied(TAB_1, true)
    instance.actions.saveFailed(TAB_1, STALE)
    instance.actions.discarded(TAB_1)
    expect(instance.getSnapshot().byTab[TAB_1]).toEqual({ revision: 1, loadId: 1, dirty: false, saving: false })
  })

  it('keeps the bucket identity when the dirty flag does not change', () => {
    const instance = createEditorStore().create()
    instance.actions.complete(TAB_1, 1, 'first', 'v1')
    const settled = instance.getSnapshot().byTab[TAB_1]
    instance.actions.dirtied(TAB_1, false)
    expect(instance.getSnapshot().byTab[TAB_1]).toBe(settled)
    instance.actions.dirtied(TAB_1, true)
    expect(instance.getSnapshot().byTab[TAB_1]?.dirty).toBe(true)
    expect(instance.getSnapshot().byTab[TAB_1]?.text).toBe('first')
  })

  it('clears the previous save failure when a retry starts and when a save settles', () => {
    const instance = createEditorStore().create()
    instance.actions.complete(TAB_1, 1, 'first', 'v1')
    instance.actions.saveFailed(TAB_1, STALE)
    instance.actions.saving(TAB_1)
    expect(instance.getSnapshot().byTab[TAB_1]?.saveFailure).toBeUndefined()
    expect(instance.getSnapshot().byTab[TAB_1]?.saving).toBe(true)
    instance.actions.saveFailed(TAB_1, STALE)
    instance.actions.saved(TAB_1, 'const answer = 42', 'v2')
    expect(instance.getSnapshot().byTab[TAB_1]).toEqual({
      revision: 1, loadId: 1, text: 'const answer = 42', version: 'v2', dirty: false, saving: false,
    })
  })

  it('leaves a refused save editable and reports the failure beside the unsaved text', () => {
    const instance = createEditorStore().create()
    instance.actions.complete(TAB_1, 1, 'const answer = 42', 'v1')
    instance.actions.dirtied(TAB_1, true)
    instance.actions.saving(TAB_1)
    instance.actions.saveFailed(TAB_1, STALE)
    expect(instance.getSnapshot().byTab[TAB_1]).toEqual({
      revision: 1, loadId: 1, text: 'const answer = 42', version: 'v1', dirty: true, saving: false, saveFailure: STALE,
    })
  })

  it('forgets one tab and keeps the rest', () => {
    const instance = createEditorStore().create()
    instance.actions.complete(TAB_1, 1, 'first', 'v1')
    instance.actions.complete(TAB_2, 1, 'other', 'v1')
    instance.actions.forget(TAB_1)
    expect(Object.keys(instance.getSnapshot().byTab)).toEqual([TAB_2])
    // Forgetting an unknown tab is a no-op, not a fault: the abort listener may
    // fire for a tab that never wrote anything.
    instance.actions.forget(TAB_9)
    expect(Object.keys(instance.getSnapshot().byTab)).toEqual([TAB_2])
  })
})
