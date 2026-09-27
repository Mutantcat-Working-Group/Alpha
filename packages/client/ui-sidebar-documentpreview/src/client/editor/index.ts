/** Editor registration: one file revision as a CodeMirror document, saved under the version guard. */
import type { Context } from '@mutantcat/cordis'
import type {} from '@mutantcat/dsh-client-locale/client'
import type {} from '@mutantcat/dsh-api-workspace-files/remote'
import type {} from '@mutantcat/dsh-client-connection/client'
import type {} from '@mutantcat/dsh-client-ui-renderer/client'
import type { TabId } from '@mutantcat/dsh-client-ui-dockkit'
import { retainDocumentTabs } from '../document/tab-lifetime.ts'
import { failureLine } from '../failure-line.ts'
import { createReadPage, createWorkspaceFileWrite } from '../rpc.ts'
import type { WriteWorkspaceFile } from '../rpc.ts'
import { en, zh } from './locales.ts'
import { EDITOR_EXTENSIONS } from './languages.ts'
import { EditorBody } from './EditorBody.tsx'
import type { EditorBodyInjected, RetainedEditorState } from './EditorBody.tsx'
import { createEditorStore } from './store.ts'
import { readEditorText } from './read.ts'
import type { ReadEditorText } from './read.ts'

/**
 * Register the editor as an optional renderer: every suffix it declares keeps
 * its builtin viewer as the file's automatic choice, and the editor joins the
 * viewer menu as the editable alternative. The reads and the write bind to the
 * Client Remote when the face is present; without it the body shows the
 * unavailable state instead of failing to load.
 * @param ctx - Client renderer registry, localized copy, and the Remote face.
 */
export function apply(ctx: Context): void {
  const id = '@mutantcat/dsh-client-ui-sidebar-documentpreview/editor'
  ctx.effect(() => ctx.locale.register('sidebarEditor', { zh, en }))
  const t = ctx.locale.bind('sidebarEditor')
  const unavailable: ReadEditorText = (_file, signal) => {
    signal.throwIfAborted()
    return Promise.reject(new Error(t('unavailable')))
  }
  const unavailableWrite: WriteWorkspaceFile = (_file, _content, _version, signal) => {
    signal.throwIfAborted()
    return Promise.reject(new Error(t('unavailable')))
  }
  let read = unavailable
  let write = unavailableWrite
  ctx.effect(() => ctx.documentPreviews.register({
    id,
    extensions: EDITOR_EXTENSIONS, priority: 'optional',
    title: () => t('title'), loading: 'renderer', wrap: true,
  }))
  const store = createEditorStore()
  const retainTab = retainDocumentTabs(ctx)
  const documentT = ctx.locale.bind('sidebarDocumentPreview')
  // The CodeMirror documents live beside the store, outliving body remounts
  // until a reload replaces them or the tab closes.
  const states = new Map<TabId, RetainedEditorState>()
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
    name: 'sidebar.right.tab.document', key: id, locale: 'sidebarEditor', store,
    inject: (_sessionId, actions): EditorBodyInjected => ({
      read: (file, signal) => read(file, signal),
      write: (file, content, version, signal) => write(file, content, version, signal),
      describeFailure: failure => 'code' in failure
        ? failureLine(documentT, failure)
        : documentT('error.unavailable', { message: failure.message }),
      retainTab: (tabId, signal) => {
        retainTab(tabId, signal, (closed) => {
          actions.forget(closed)
          states.delete(closed)
        })
      },
      stateOf: tabId => states.get(tabId),
      keepState: (tabId, retained) => { states.set(tabId, retained) },
      dropState: (tabId) => { states.delete(tabId) },
    }),
  }, EditorBody)))
  ctx.inject(['remote', 'remote.workspaceFiles'], (scope) => {
    read = (file, signal) => readEditorText(
      createReadPage(scope.remote), file, signal, () => new Error(t('changed')),
    )
    write = createWorkspaceFileWrite(scope.remote)
    scope.effect(() => () => { read = unavailable; write = unavailableWrite })
  })
}
