/** Loaded editor contents survive body remounts until reload or tab closure. */
import { defineStore, type EngineStoreHandle } from '@mutantcat/dsh-client-store'
import type { TabId } from '@mutantcat/dsh-client-ui-dockkit'

/** One requested source revision and the text settled for it. */
export interface EditorTabState {
  /** The content revision this view belongs to, as the document owner counts them. */
  readonly revision: number
  /** Fresh-read counter; a change re-creates the CodeMirror document. */
  readonly loadId: number
  /** The complete file text; absent until the first read settles. */
  readonly text?: string
  /** The version the text belongs to; the guard the next save names. */
  readonly version?: string
  /** Why the last read failed; absent once a read settles. */
  readonly failure?: { readonly code: string; readonly message: string }
  /** The text differs from what `version` names on disk. */
  readonly dirty: boolean
  /** A save is in flight. */
  readonly saving: boolean
  /** Why the last save failed; absent once a save settles. */
  readonly saveFailure?: { readonly code: string; readonly message: string }
}

/** Editor-owned content, isolated by tab identity. */
export interface EditorState {
  byTab: Record<TabId, EditorTabState>
}

/** A read or save failure as the store keeps it. */
type EditorFailure = NonNullable<EditorTabState['failure']>

/** The editor store's write set; every action names the tab it writes. */
type EditorActions = {
  loading: (state: EditorState, tab: TabId, revision: number) => void
  complete: (state: EditorState, tab: TabId, revision: number, text: string, version: string) => void
  failed: (state: EditorState, tab: TabId, revision: number, failure: EditorFailure) => void
  kept: (state: EditorState, tab: TabId, revision: number) => void
  discarded: (state: EditorState, tab: TabId) => void
  dirtied: (state: EditorState, tab: TabId, dirty: boolean) => void
  saving: (state: EditorState, tab: TabId) => void
  saved: (state: EditorState, tab: TabId, text: string, version: string) => void
  saveFailed: (state: EditorState, tab: TabId, failure: EditorFailure) => void
  forget: (state: EditorState, tab: TabId) => void
}

/**
 * Retain editor contents across body remounts within a Session.
 * @returns the tab-content store declaration.
 */
export function createEditorStore(): EngineStoreHandle<EditorState, EditorActions> {
  return defineStore({
    init: (): EditorState => ({ byTab: {} }),
    actions: {
      /** @param state - draft. @param tab - owning tab. @param revision - requested revision. */
      loading(state, tab: TabId, revision: number) {
        const previous = state.byTab[tab]
        state.byTab[tab] = { revision, loadId: previous?.loadId ?? 0, dirty: false, saving: false }
      },
      /**
       * Settle one read. The fresh `loadId` re-creates the CodeMirror
       * document, so a reload never shows the previous text's undo history.
       * @param state - draft. @param tab - owning tab. @param revision - completed revision.
       * @param text - complete file text. @param version - version the text belongs to.
       */
      complete(state, tab: TabId, revision: number, text: string, version: string) {
        const previous = state.byTab[tab]
        state.byTab[tab] = {
          revision, loadId: (previous?.loadId ?? 0) + 1, text, version, dirty: false, saving: false,
        }
      },
      /** @param state - draft. @param tab - owning tab. @param revision - failed revision. @param failure - displayable failure. */
      failed(state, tab: TabId, revision: number, failure: EditorFailure) {
        const previous = state.byTab[tab]
        state.byTab[tab] = { revision, loadId: previous?.loadId ?? 0, failure, dirty: false, saving: false }
      },
      /**
       * Adopt a new revision without discarding unsaved edits. The text, its
       * version, and the dirty flag stay, so the owner's change bar keeps
       * announcing the version on disk.
       * @param state - draft. @param tab - owning tab. @param revision - revision to adopt.
       */
      kept(state, tab: TabId, revision: number) {
        const previous = state.byTab[tab]
        if (previous === undefined) return
        state.byTab[tab] = { ...previous, revision }
      },
      /**
       * Abandon the held text after a refused save, so the next read settles a
       * fresh `loadId` and the retained CodeMirror document is not reused.
       * @param state - draft. @param tab - owning tab.
       */
      discarded(state, tab: TabId) {
        const previous = state.byTab[tab]
        if (previous === undefined) return
        state.byTab[tab] = { revision: previous.revision, loadId: previous.loadId, dirty: false, saving: false }
      },
      /**
       * Record whether the document differs from the text last read or saved.
       * @param state - draft. @param tab - owning tab. @param dirty - whether the document differs.
       */
      dirtied(state, tab: TabId, dirty: boolean) {
        const previous = state.byTab[tab]
        if (previous === undefined || previous.dirty === dirty) return
        state.byTab[tab] = { ...previous, dirty }
      },
      /** @param state - draft. @param tab - owning tab. */
      saving(state, tab: TabId) {
        const previous = state.byTab[tab]
        if (previous === undefined) return
        const { saveFailure: _retried, ...rest } = previous
        state.byTab[tab] = { ...rest, saving: true }
      },
      /**
       * Settle one save. The text written becomes the new baseline, so the
       * document reads as clean until the next edit.
       * @param state - draft. @param tab - owning tab. @param text - content written.
       * @param version - version the write produced.
       */
      saved(state, tab: TabId, text: string, version: string) {
        const previous = state.byTab[tab]
        if (previous === undefined) return
        const { saveFailure: _written, ...rest } = previous
        state.byTab[tab] = { ...rest, text, version, dirty: false, saving: false }
      },
      /** @param state - draft. @param tab - owning tab. @param failure - displayable save failure. */
      saveFailed(state, tab: TabId, failure: EditorFailure) {
        const previous = state.byTab[tab]
        if (previous === undefined) return
        state.byTab[tab] = { ...previous, saving: false, saveFailure: failure }
      },
      /** @param state - draft. @param tab - closed tab. */
      forget(state, tab: TabId) {
        const { [tab]: _closed, ...remaining } = state.byTab
        state.byTab = remaining
      },
    },
  })
}

/** Store declaration used by the editor body. */
export type EditorStore = ReturnType<typeof createEditorStore>
