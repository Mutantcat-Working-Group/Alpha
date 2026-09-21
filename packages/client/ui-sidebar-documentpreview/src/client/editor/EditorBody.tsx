/**
 * The editor body: one file revision as a CodeMirror document, with a guarded
 * save.
 *
 * The document owner supplies the revision, the reload, and the wrap
 * preference; the text is this body's own business. One store view per tab
 * keeps the text, its version, and the dirty flag while the tab lives, and
 * the CodeMirror document itself is retained beside the store, keyed by the
 * view's `loadId`, so returning to a tab restores the cursor, the selections,
 * and the undo history without another read.
 *
 * A save writes the whole document at the version it was read, so a change
 * made elsewhere is refused rather than overwritten. Unsaved edits outrank a
 * reload: the new revision is adopted with the text intact, which leaves the
 * owner's change bar announcing the version on disk.
 */
import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import type { PropsLocale, PropsStore } from '@mutantcat/dsh-client-ui-slots'
import type { RemoteFailure } from '@mutantcat/dsh-api-remotes/client'
import type { TranslateNS } from '@mutantcat/dsh-client-locale/client'
import type { TabId } from '@mutantcat/dsh-client-ui-dockkit'
import { Button, FileTypeIcon, classifyFileType } from '@mutantcat/dsh-client-ui-primitives'
import { pathPartsOf } from '@mutantcat/dsh-util-workspace-path'
import type { DocumentPreviewProps } from '../document/contract.ts'
import { hostFileOf } from '../rpc.ts'
import type { WriteWorkspaceFile } from '../rpc.ts'
import { LoadingIndicator } from '../LoadingIndicator.tsx'
import { IconSaveFill16 } from '../icons.tsx'
import { editorLanguageOf } from './languages.ts'
import type { ReadEditorText } from './read.ts'
import type { EditorStore, EditorTabState } from './store.ts'
import { writeFailureLine } from './write-failure.ts'
import common from '../TextPreview.module.css'
import css from './EditorBody.module.css'

/** One CodeMirror document retained while its tab lives, so a remount restores it. */
export interface RetainedEditorState {
  /** The store view's `loadId`; a fresh read re-creates the document. */
  readonly loadId: number
  /** The document, with its undo history, cursor, and selections. */
  readonly state: EditorState
  /** Reconfigures line wrapping without re-creating the document. */
  readonly wrap: Compartment
}

/** Editor body inputs: the reads and writes, failure copy, tab retention, and retained documents. */
export interface EditorBodyInjected {
  readonly read: ReadEditorText
  readonly write: WriteWorkspaceFile
  /** @param failure - declared read failure or exception message. @returns localized display text. */
  readonly describeFailure: (failure: RemoteFailure | { readonly message: string }) => string
  /** @param tab - owning tab. @param signal - tab lifetime, including hidden bodies. */
  readonly retainTab: (tab: TabId, signal: AbortSignal) => void
  /** @param tab - owning tab. @returns the retained document, when one survives for it. */
  readonly stateOf: (tab: TabId) => RetainedEditorState | undefined
  /** @param tab - owning tab. @param retained - the document to keep across remounts. */
  readonly keepState: (tab: TabId, retained: RetainedEditorState) => void
  /** @param tab - closed tab. */
  readonly dropState: (tab: TabId) => void
}

/** Editor body inputs and its private store. */
export type EditorBodyProps = DocumentPreviewProps & PropsStore<EditorStore> & EditorBodyInjected
  & PropsLocale<'sidebarEditor'>

/** The newest render's callbacks, read by CodeMirror listeners that outlive a render. */
interface EditorLatest {
  readonly held: EditorTabState | undefined
  readonly write: WriteWorkspaceFile
  readonly actions: EditorBodyProps['actions']
  readonly t: TranslateNS<'sidebarEditor'>
}

/**
 * The editor's own theme, layered over CodeMirror's base theme. Every value is
 * a design token, so light and dark resolve without a second spec. Selection
 * and cursor colors stay with the base theme, which already adapts.
 */
const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--dsw-alias-label-primary)',
    backgroundColor: 'var(--dsw-alias-bg-base)',
    fontSize: 'var(--dsh-content-font-size-secondary, 13px)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--ds-font-family-code)',
    lineHeight: '1.6',
  },
  '.cm-gutters': {
    color: 'var(--dsw-alias-label-tertiary)',
    backgroundColor: 'transparent',
    border: 'none',
  },
  '.cm-gutters.cm-gutters-before': {
    borderRight: '0.5px solid var(--dsw-alias-border-l3)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--dsw-alias-interactive-bg-hover)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--dsw-alias-interactive-bg-hover)',
  },
  '&.cm-focused': {
    outline: '1px solid var(--dsw-alias-border-l2)',
    outlineOffset: '-1px',
  },
})

/**
 * Load one file revision into an editable document and save it under the
 * version guard.
 * @param props - renderer loading request, tab state, read and write callbacks, and copy.
 * @returns the loading or failure state, or the editor with its save strip.
 */
export function EditorBody(props: EditorBodyProps): ReactNode {
  const { tab } = props.useTabInfo()
  const { actions, read, write, describeFailure, retainTab, stateOf, keepState, dropState, resourceAddress, t } = props
  const request = props.content.kind === 'renderer' ? props.content : undefined
  const revision = request?.revision
  const held = props.useStore(state => state.byTab[tab.id])
  // Unsaved edits meeting a newer revision: the reload is adopted, not read.
  const editable = held !== undefined && revision !== undefined && held.dirty && held.revision !== revision
  const view = held !== undefined && (held.revision === revision || editable) ? held : undefined
  const settled = view?.text !== undefined || view?.failure !== undefined
  const content = view?.text !== undefined && view.version !== undefined ? view : undefined
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const wrapRef = useRef<Compartment | null>(null)
  const latest = useRef<EditorLatest | null>(null)
  // The keymap and the update listener outlive the render that bound them, so
  // both read the newest held view through this ref.
  latest.current = { held: view, write, actions, t }
  useEffect(() => { retainTab(tab.id, tab.signal) }, [retainTab, tab.id, tab.signal])
  useEffect(() => {
    if (revision === undefined || tab.signal.aborted) return
    if (editable) {
      // Adopting the revision settles this view, so the check comes before it.
      actions.kept(tab.id, revision)
      return
    }
    if (settled) return
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, tab.signal])
    actions.loading(tab.id, revision)
    void read(hostFileOf(resourceAddress), signal).then((result) => {
      if (signal.aborted) return
      if (result.ok) actions.complete(tab.id, revision, result.value.text, result.value.version)
      else actions.failed(tab.id, revision, { code: result.error.code, message: describeFailure(result.error) })
    }, (error: unknown) => {
      if (signal.aborted) return
      actions.failed(tab.id, revision, {
        code: 'gateway/internal',
        message: describeFailure({ message: error instanceof Error ? error.message : String(error) }),
      })
    })
    return () => { controller.abort() }
  }, [revision, resourceAddress, tab.id, tab.signal, read, actions, describeFailure, settled, editable])
  // The owner's change bar watches the version on disk against the one this
  // body reports, so a remount with retained contents reports it again.
  useEffect(() => { if (content?.version !== undefined) request?.loaded(content.version) }, [content, request?.loaded])
  const save = useCallback((): void => {
    const current = latest.current
    const heldNow = current?.held
    const mounted = viewRef.current
    if (current === null || heldNow?.dirty !== true || heldNow.saving || heldNow.version === undefined || mounted === null) return
    const text = mounted.state.doc.toString()
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, tab.signal])
    current.actions.saving(tab.id)
    void current.write(hostFileOf(resourceAddress), text, heldNow.version, signal).then((result) => {
      if (signal.aborted) return
      if (result.ok) {
        current.actions.saved(tab.id, text, result.value.version)
        // The document may have moved on while the write was in flight.
        current.actions.dirtied(tab.id, mounted.state.doc.toString() !== text)
      } else {
        current.actions.saveFailed(tab.id, { code: result.error.code, message: writeFailureLine(current.t, result.error) })
      }
    }, (error: unknown) => {
      if (signal.aborted) return
      current.actions.saveFailed(tab.id, {
        code: 'gateway/internal',
        message: current.t('error.writeFailed', { message: error instanceof Error ? error.message : String(error) }),
      })
    })
  }, [resourceAddress, tab.id, tab.signal])
  const discard = useCallback((): void => {
    // The version guard refused the save, so the text on disk is the one to
    // look at: drop the retained document and the unsaved edits with it.
    dropState(tab.id)
    actions.discarded(tab.id)
    request?.reload()
  }, [dropState, actions, tab.id, request?.reload])
  const language = editorLanguageOf(hostFileOf(resourceAddress).path)
  useEffect(() => {
    const host = hostRef.current
    if (host === null || content?.text === undefined) return
    const text = content.text
    const retained = stateOf(tab.id)
    const reused = retained?.loadId === content.loadId ? retained : undefined
    const wrap = reused?.wrap ?? new Compartment()
    const state = reused?.state ?? EditorState.create({
      doc: text,
      extensions: [
        history(),
        keymap.of([{ key: 'Mod-s', run: () => { save(); return true } }, ...defaultKeymap, ...historyKeymap]),
        drawSelection(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        lineNumbers(),
        // The wrap effect below reconfigures the compartment on every mount,
        // so the value captured here never survives a preference change.
        wrap.of(props.wrap ? [EditorView.lineWrapping] : []),
        ...language === undefined ? [] : [language],
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          const current = latest.current
          /* v8 ignore next -- the listener runs only while a view is mounted, which assigns the ref. */
          if (current === null) return
          current.actions.dirtied(tab.id, update.state.doc.toString() !== current.held?.text)
        }),
        editorTheme,
      ],
    })
    const mounted = new EditorView({ state, parent: host })
    viewRef.current = mounted
    wrapRef.current = wrap
    return () => {
      viewRef.current = null
      wrapRef.current = null
      keepState(tab.id, { loadId: content.loadId, state: mounted.state, wrap })
      mounted.destroy()
    }
  }, [content?.loadId, tab.id, keepState, stateOf, save, language])
  // Line wrapping rides a compartment, so toggling it never re-creates the
  // document. This runs after the mount effect on a fresh mount.
  useEffect(() => {
    const wrap = wrapRef.current
    if (wrap === null) return
    viewRef.current?.dispatch({ effects: wrap.reconfigure(props.wrap ? [EditorView.lineWrapping] : []) })
  }, [props.wrap])
  if (request === undefined) return null
  if (view?.failure !== undefined) {
    const { name } = pathPartsOf(resourceAddress)
    return <div className={common.empty} data-editor-failed={view.failure.code}>
      <FileTypeIcon kind={classifyFileType(name)} size={36} />
      <p className={common.emptyLine}>{view.failure.message}</p>
      <Button size="sm" onClick={request.reload}>{t('retry')}</Button>
    </div>
  }
  if (content === undefined) return <LoadingIndicator className={common.statusLine} label={t('loading')} />
  return (
    <div className={css.editor} data-editor>
      {(content.dirty || content.saving || content.saveFailure !== undefined) && (
        <div className={css.strip} data-editor-strip>
          {content.saveFailure !== undefined && <p className={css.failure}>{content.saveFailure.message}</p>}
          <div className={css.controls}>
            {content.saveFailure?.code === 'workspace-file/stale-version' && (
              <button type="button" className={css.control} data-editor-discard onClick={discard}>{t('discard')}</button>
            )}
            <button
              type="button"
              className={css.control}
              data-editor-save
              disabled={content.saving || !content.dirty}
              onClick={save}
            >
              {content.saving ? <LoadingIndicator label={t('saving')} /> : <IconSaveFill16 size={14} />}
              {content.saving ? t('saving') : t('save')}
            </button>
          </div>
        </div>
      )}
      <div className={css.host} ref={hostRef} data-editor-host />
    </div>
  )
}
