import { useState } from 'react'
import type { ReactNode } from 'react'
import { IconDownloadOutline16, IconEllipsisOutline16, IconListPenOutline16, Menu } from '@mutantcat/dsh-client-ui-primitives'
import { SessionLogDownloadDialog, type SessionLogDownloadDialogProps } from './Dialog.tsx'
import css from './HeaderAction.module.css'

/**
 * Render the Session Header more-actions icon button, its download menu, and the shared result dialog.
 * @param props - Session runtime, download controller, and localized copy.
 * @returns the persistent Header action and Session-scoped dialog.
 */
export function SessionLogDownloadHeaderAction(props: SessionLogDownloadDialogProps): ReactNode {
  const { sessionId, useSessionLogDownload, useSessions, request, exportMarkdown, t } = props
  const entry = useSessionLogDownload(state => state.bySession[String(sessionId)])
  const busy = entry?.status === 'downloading'
  const title = useSessions(state => state.byId[sessionId]?.displayTitle) ?? String(sessionId)
  const [open, setOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  const runMarkdownExport = (): void => {
    setExporting(true)
    void exportMarkdown(sessionId, title).then(
      () => { setExporting(false) },
      (reason: unknown) => {
        setExporting(false)
        console.warn('session Markdown export rejected:', reason)
      },
    )
  }

  return (
    <>
      <Menu
        open={open}
        align="end"
        dense
        onClose={() => { setOpen(false) }}
        items={[
          { id: 'download', label: t('menu.download'), icon: <IconDownloadOutline16 />, disabled: busy },
          { id: 'markdown', label: t('menu.exportMarkdown'), icon: <IconListPenOutline16 />, disabled: exporting },
        ]}
        onSelect={(id) => {
          setOpen(false)
          if (id === 'markdown') runMarkdownExport()
          else void request(sessionId)
        }}
        anchor={(
          <button
            type="button"
            className={css.moreButton}
            aria-label={t('header.more')}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-busy={busy}
            onClick={() => { setOpen(value => !value) }}
          >
            <IconEllipsisOutline16 />
          </button>
        )}
      />
      <SessionLogDownloadDialog {...props} />
    </>
  )
}
