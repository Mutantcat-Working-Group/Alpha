/**
 * Session management Settings page: foreign session import plus local session
 * management (archive and Markdown export).
 *
 * The import section reads the configured source root and imports foreign
 * sessions. The local session section lists the current app's sessions with
 * archive and export actions.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@mutantcat/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@mutantcat/dsh-client-ui-slots'
import type {
  SessionImportHarnessRequest,
  SessionImportHarnessResult,
  SessionImportHarnessValue,
} from '@mutantcat/dsh-api-session-controller/types'
import css from './ImportSessionsSection.module.css'

/** Registration-side face used by the page. */
export interface ImportSessionsSectionInjected {
  /**
   * Read the deployment's configured default source sessions root.
   * @returns the configured foreign sessions root.
   */
  sourceRoot: () => Promise<string>
  /**
   * Import every Session under one source root, then refresh the Session list.
   * @param request - optional source-root override.
   * @returns the effective source root and one result per discovered Session.
   */
  importSessions: (request: SessionImportHarnessRequest) => Promise<SessionImportHarnessValue>
  /**
   * Export one local session as Markdown.
   * @param sessionId - Session to export.
   * @returns the Markdown transcript string.
   */
  exportSession: (sessionId: string) => Promise<string>
  /**
   * Archive one local session.
   * @param sessionId - Session to archive.
   */
  archiveSession: (sessionId: string) => Promise<void>
}

/** Full component props assembled by the Settings slot renderer. */
export type ImportSessionsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.importSessions'>
  & InjectFace<ImportSessionsSectionInjected>

type Translate = ImportSessionsSectionProps['t']

/** One import outcome's presentation label key. */
const STATUS_KEY: Readonly<Record<SessionImportHarnessResult['status'], 'status.imported' | 'status.alreadyPresent' | 'status.refused'>> = {
  imported: 'status.imported',
  'already-present': 'status.alreadyPresent',
  refused: 'status.refused',
}

/** One import outcome's status badge class. */
const STATUS_CLASS: Readonly<Record<SessionImportHarnessResult['status'], string | undefined>> = {
  imported: css.statusImported,
  'already-present': css.statusPresent,
  refused: css.statusRefused,
}

/** Counts of each outcome in one completed run. */
interface ResultCounts {
  imported: number
  alreadyPresent: number
  refused: number
}

/** Tally one completed run's outcomes. */
function countOf(results: readonly SessionImportHarnessResult[]): ResultCounts {
  const counts: ResultCounts = { imported: 0, alreadyPresent: 0, refused: 0 }
  for (const result of results) {
    if (result.status === 'imported') counts.imported += 1
    else if (result.status === 'already-present') counts.alreadyPresent += 1
    else counts.refused += 1
  }
  return counts
}

/** Localized identity of one result row: the Session id, else its source path. */
function identityOf(result: SessionImportHarnessResult, t: Translate): string {
  return result.sessionId === undefined
    ? result.sourcePath
    : t('resultSession', { id: String(result.sessionId) })
}

/** Human-readable message for a hostile non-Error rejection. */
function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
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
 * Render the session management page.
 * @param props - composed slot props (see {@link ImportSessionsSectionProps}).
 * @returns the settings page element tree.
 */
export function ImportSessionsSection(props: ImportSessionsSectionProps): ReactNode {
  const { t, sourceRoot, importSessions, exportSession, archiveSession, useSessions } = props
  const [root, setRoot] = useState('')
  const [ready, setReady] = useState(false)
  const [running, setRunning] = useState(false)
  const [value, setValue] = useState<SessionImportHarnessValue | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [exporting, setExporting] = useState<string | undefined>(undefined)
  const sessions = useSessions(state => state)
  // The inject face is rebuilt per registration, so the one-shot read of the
  // configured default must not re-run when its identity changes.
  const readSourceRoot = useRef(sourceRoot)
  readSourceRoot.current = sourceRoot

  useEffect(() => {
    let cancelled = false
    readSourceRoot.current().then(
      (configured) => {
        if (cancelled) return
        setRoot(configured)
        setReady(true)
      },
      (reason: unknown) => {
        if (cancelled) return
        setError(messageOf(reason))
        setReady(true)
      },
    )
    return () => { cancelled = true }
  }, [])

  const runImport = (): void => {
    const requested = root.trim()
    setRunning(true)
    setError(undefined)
    setValue(undefined)
    void importSessions(requested === '' ? {} : { sourceRoot: requested }).then(
      (result) => {
        setValue(result)
        setRunning(false)
      },
      (reason: unknown) => {
        setError(messageOf(reason))
        setRunning(false)
      },
    )
  }

  const runExport = (sessionId: string, title: string): void => {
    setExporting(sessionId)
    setError(undefined)
    void exportSession(sessionId).then(
      (markdown) => {
        downloadText(`${title}.md`, markdown)
        setExporting(undefined)
      },
      (reason: unknown) => {
        setError(messageOf(reason))
        setExporting(undefined)
      },
    )
  }

  const runArchive = (sessionId: string): void => {
    setError(undefined)
    void archiveSession(sessionId).catch((reason: unknown) => {
      setError(messageOf(reason))
    })
  }

  const counts = countOf(value?.results ?? [])
  const localSessions = sessions.phase === 'ready'
    ? sessions.ids.map(id => sessions.byId[id]).filter((s): s is NonNullable<typeof s> => s !== undefined && !s.blank)
    : []

  return (
    <div className={css.section}>
      {/* Import section */}
      <label className={css.field} htmlFor="import-sessions-source-root">
        <span className={css.label}>{t('sourceRoot')}</span>
        <input
          id="import-sessions-source-root"
          type="text"
          value={root}
          placeholder={t('sourceRootHint')}
          aria-label={t('sourceRoot')}
          disabled={running}
          onChange={(event) => { setRoot(event.currentTarget.value) }}
        />
      </label>
      {!ready ? <p className={css.status}>{t('readingSourceRoot')}</p> : null}
      <div className={css.action}>
        <Button
          variant="primary"
          size="sm"
          disabled={running || !ready}
          onClick={runImport}
        >
          {running ? t('importing') : t('import')}
        </Button>
      </div>
      {running ? <p className={css.status} role="status">{t('importing')}</p> : null}
      {error === undefined ? null : <p className={css.error}>{t('failed', { message: error })}</p>}
      {value === undefined ? null : (
        <>
          <p className={css.status}>
            {t('summary', {
              total: value.results.length,
              imported: counts.imported,
              alreadyPresent: counts.alreadyPresent,
              refused: counts.refused,
            })}
          </p>
          {value.results.length === 0
            ? <p className={css.status}>{t('emptyResults')}</p>
            : (
              <ul className={css.list} aria-label={t('results')}>
                {value.results.map(result => (
                  <li key={result.sourcePath} className={css.row}>
                    <span className={css.identity}>{identityOf(result, t)}</span>
                    <span className={STATUS_CLASS[result.status]}>
                      {t(STATUS_KEY[result.status])}
                    </span>
                    {result.reason === undefined
                      ? null
                      : <span className={css.reason}>{t('refusedReason', { reason: result.reason })}</span>}
                  </li>
                ))}
              </ul>
            )}
        </>
      )}

      {/* Local sessions section */}
      <h3 className={css.label}>{t('localSessions')}</h3>
      <p className={css.status}>{t('localSessionsHint')}</p>
      {localSessions.length === 0
        ? <p className={css.status}>{t('noLocalSessions')}</p>
        : (
          <ul className={css.list} aria-label={t('localSessions')}>
            {localSessions.map(session => (
              <li key={session.id} className={css.row}>
                <span className={css.identity}>{session.displayTitle}</span>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t('exportNamed', { title: session.displayTitle })}
                  disabled={exporting === session.id}
                  onClick={() => { runExport(session.id, session.displayTitle) }}
                >
                  {exporting === session.id ? t('exporting') : t('exportMd')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t('archiveNamed', { title: session.displayTitle })}
                  onClick={() => { runArchive(session.id) }}
                >
                  {t('archive')}
                </Button>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}
