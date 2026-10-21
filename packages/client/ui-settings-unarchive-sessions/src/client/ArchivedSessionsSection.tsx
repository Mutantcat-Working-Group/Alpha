/**
 * Archived-session Settings page: the registry-global archive set joined with
 * the loaded Session summaries, newest archive first, filtered by one search
 * box, with Unarchive and Export actions per row. An archive entry whose
 * Session is gone has no row and no action; the set itself stays host-owned.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { Button, IconSearchOutline16, relativeTime } from '@mutantcat/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@mutantcat/dsh-client-ui-slots'
import type { SessionId } from '@mutantcat/dsh-session/types'
import css from './ArchivedSessionsSection.module.css'

/** Registration-side face used by the page. */
export interface ArchivedSessionsSectionInjected {
  /**
   * Restore one archived Session.
   * @param sessionId - Session to unarchive.
   */
  unarchive: (sessionId: SessionId) => Promise<void>
  /**
   * Export one archived Session as Markdown.
   * @param sessionId - Session to export.
   * @returns the Markdown transcript string.
   */
  exportSession: (sessionId: SessionId) => Promise<string>
}

/** Full component props assembled by the Settings slot renderer. */
export type ArchivedSessionsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.archivedSessions'>
  & InjectFace<ArchivedSessionsSectionInjected>

type Translate = ArchivedSessionsSectionProps['t']

/** One archived Session as the page renders it. */
interface ArchivedRow {
  id: SessionId
  title: string
  /** Owning Workspace title, or the ungrouped label for a Session outside every Workspace. */
  workspace: string
  updatedAt: number
}

/** Localized compact relative time of one row's last activity. */
function timeLabel(updatedAt: number, now: number, t: Translate): string {
  const { unit, n } = relativeTime(updatedAt, now)
  return unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
}

/** Whether one row matches the normalized query in its title or Workspace label. */
function matches(row: ArchivedRow, normalizedQuery: string): boolean {
  return normalizedQuery.length === 0
    || row.title.toLowerCase().includes(normalizedQuery)
    || row.workspace.toLowerCase().includes(normalizedQuery)
}

/** Trigger a browser download of one text blob. */
function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * Render the archived-session page.
 * @param props - composed slot props (see {@link ArchivedSessionsSectionProps}).
 * @returns the settings page element tree.
 */
export function ArchivedSessionsSection(props: ArchivedSessionsSectionProps): ReactNode {
  const { t, unarchive, exportSession, useSessions, useWorkspaces } = props
  const sessions = useSessions(state => state)
  const workspaces = useWorkspaces(state => state.items)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const [query, setQuery] = useState('')
  const [exporting, setExporting] = useState<string | undefined>(undefined)
  const ungrouped = t('ungrouped')
  const summaries = sessions.byId

  // Archive order is oldest first; the page lists the most recently archived
  // Session first. A member with no loaded summary is not addressable here.
  const rows = useMemo<ArchivedRow[]>(() => {
    const owners = new Map<string, string>()
    for (const workspace of workspaces) {
      for (const id of workspace.sessionIds) owners.set(id, workspace.title)
    }
    return [...archivedSessionIds].reverse().flatMap((id) => {
      const summary = summaries[id]
      if (summary === undefined) return []
      return [{
        id,
        title: summary.displayTitle,
        workspace: owners.get(id) ?? ungrouped,
        updatedAt: summary.updatedAt,
      }]
    })
  }, [archivedSessionIds, workspaces, summaries, ungrouped])

  if (sessions.phase !== 'ready') return <p className={css.status}>{t('loading')}</p>

  const now = Date.now()
  const visible = rows.filter(row => matches(row, query.trim().toLowerCase()))
  const archived = archivedSessionIds.length > 0

  const runExport = (row: ArchivedRow): void => {
    setExporting(row.id)
    void exportSession(row.id).then(
      (markdown) => {
        downloadText(`${row.title}.md`, markdown)
        setExporting(undefined)
      },
      () => { setExporting(undefined) },
    )
  }

  return (
    <div className={css.section}>
      <div className={css.search}>
        <IconSearchOutline16 aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder={t('search')}
          aria-label={t('search')}
          onChange={(event) => { setQuery(event.currentTarget.value) }}
        />
      </div>
      {!archived ? <p className={css.status}>{t('empty')}</p> : null}
      {archived && rows.length === 0 ? <p className={css.status}>{t('unavailable')}</p> : null}
      {rows.length > 0 && visible.length === 0 ? <p className={css.status}>{t('emptySearch')}</p> : null}
      {visible.length > 0 ? (
        <ul className={css.list}>
          {visible.map(row => (
            <li key={row.id} className={css.row}>
              <span className={css.identity}>
                <span className={css.title}>{row.title}</span>
                <span className={css.meta}>
                  {[row.workspace, timeLabel(row.updatedAt, now, t)].join(' · ')}
                </span>
              </span>
              <Button
                variant="outline"
                size="sm"
                aria-label={t('exportNamed', { title: row.title })}
                disabled={exporting === row.id}
                onClick={() => { runExport(row) }}
              >
                {exporting === row.id ? t('exporting') : t('exportMd')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-label={t('unarchiveNamed', { title: row.title })}
                onClick={() => {
                  unarchive(row.id).catch((reason: unknown) => {
                    console.warn('session unarchive rejected:', reason)
                  })
                }}
              >
                {t('unarchive')}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
