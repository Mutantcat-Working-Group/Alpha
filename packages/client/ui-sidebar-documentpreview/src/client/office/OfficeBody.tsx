/** Office owns source loading, conversion failures, and font notices around the shared PDF view. */
import { useEffect, type ReactNode } from 'react'
import type { PropsLocale, PropsRenderSlots, PropsStore, SlotHookFactory } from '@mutantcat/dsh-client-ui-slots'
import type { RemoteFailure } from '@mutantcat/dsh-api-remotes/client'
import type { TabId } from '@mutantcat/dsh-client-ui-dockkit'
import type { UseSidebarRightTabInfo } from '@mutantcat/dsh-client-ui-sidebar-right/client'
import type { DocumentBodyOwner, DocumentPreviewProps } from '../document/contract.ts'
import { ReadFailureView } from '../document/ReadFailureView.tsx'
import { readRevision } from '../document/read-revision.ts'
import { LoadingIndicator } from '../LoadingIndicator.tsx'
import type { ReadOfficeDocument } from './cache.ts'
import type { OfficeStore } from './store.ts'
import { FontNotice } from './FontNotice.tsx'
import common from '../TextPreview.module.css'
import css from './OfficeBody.module.css'

declare module '@mutantcat/dsh-client-ui-slots' {
  interface SlotMap {
    /** PDF presentation supplied with Office-owned converted bytes. */
    'sidebar.right.tab.document.office.pdf': {
      kind: 'keyed'
      scope: 'session'
      owner: DocumentBodyOwner
      hookContext: UseSidebarRightTabInfo
      inject: { hooks: { tabInfo: SlotHookFactory<'sidebar.right.tab.document', UseSidebarRightTabInfo> } }
    }
  }
}

/** Office loading callbacks supplied by the registration's services. */
export interface OfficeBodyInjected {
  readonly read: ReadOfficeDocument
  /** @param failure - declared file-read failure or conversion exception message. @returns localized display text. */
  readonly describeFailure: (failure: RemoteFailure | { readonly message: string }) => string
  /** @param tab - owning tab. @param signal - tab lifetime, including hidden bodies. */
  readonly retainTab: (tab: TabId, signal: AbortSignal) => void
}

/** Office body inputs and its private PDF child. */
export type OfficeBodyProps = DocumentPreviewProps & PropsStore<OfficeStore> & OfficeBodyInjected
  & PropsLocale<'sidebarOffice'> & PropsRenderSlots<'sidebar.right.tab.document.office.pdf'>

/**
 * Load one Office revision and preserve its result while its tab remains open.
 * @param props - renderer loading request, tab state, conversion callbacks, and PDF slot.
 * @returns conversion status or the font notice and PDF scrollport.
 */
export function OfficeBody(props: OfficeBodyProps): ReactNode {
  const { tab } = props.useTabInfo()
  const { actions, read, retainTab, describeFailure, resourceAddress, t } = props
  const request = props.content.kind === 'renderer' ? props.content : undefined
  const revision = request?.revision
  const held = props.useStore(state => state.byTab[tab.id])
  const view = held?.revision === revision ? held : undefined
  const settled = view?.file !== undefined || view?.failure !== undefined
  useEffect(() => { retainTab(tab.id, tab.signal) }, [retainTab, tab.id, tab.signal])
  useEffect(() => {
    if (revision === undefined || settled || tab.signal.aborted) return
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, tab.signal])
    actions.loading(tab.id, revision)
    void readRevision(read, resourceAddress, signal, {
      complete: (value) => { actions.complete(tab.id, revision, value) },
      failed: (failure) => { actions.failed(tab.id, revision, failure) },
      describeFailure,
    })
    return () => { controller.abort() }
  }, [revision, resourceAddress, tab.id, tab.signal, read, actions, describeFailure, settled])
  const file = view?.file
  useEffect(() => { if (file !== undefined) request?.loaded(file.version) }, [file, request?.loaded])
  if (request === undefined) return null
  if (view?.failure !== undefined) {
    return <ReadFailureView marker="textpreview" resourceAddress={resourceAddress}
      failure={view.failure} reload={request.reload} retry={t('retry')} />
  }
  if (file === undefined) return <LoadingIndicator className={common.statusLine} label={t('loading')} />
  return <div className={css.body}>
    <FontNotice resourceAddress={resourceAddress} sourceVersion={file.version} fonts={file.missingFonts} t={t} />
    <div className={css.scrollport} ref={props.scrollportRef}>
      {props.renderSlot('sidebar.right.tab.document.office.pdf', {
        resourceAddress, content: { kind: 'bytes', data: file.data }, wrap: props.wrap, scrollportRef: props.scrollportRef,
      }, { entryKey: '@mutantcat/dsh-client-ui-sidebar-documentpreview/office', hookContext: props.useTabInfo })}
    </div>
  </div>
}
