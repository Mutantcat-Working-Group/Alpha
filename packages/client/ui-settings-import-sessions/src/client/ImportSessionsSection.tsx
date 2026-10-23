/**
 * Session management Settings page: foreign session import plus local session
 * management (archive and Markdown export).
 *
 * The import section discovers which Agent session stores are installed on the
 * Host machine, offers them in one dropdown, and imports the picked store. The
 * local session section lists the current app's sessions with archive and
 * export actions.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@mutantcat/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@mutantcat/dsh-client-ui-slots'
import type {
  SessionImportHarnessRequest,
  SessionImportHarnessResult,
  SessionImportHarnessValue,
  SessionImportHarnessAgentSource,
  SessionImportHarnessSourcesValue,
} from '@mutantcat/dsh-api-session-controller/types'
import css from './ImportSessionsSection.module.css'

/** Registration-side face used by the page. */
export interface ImportSessionsSectionInjected {
  /**
   * List the Agent session stores installed on the Host machine.
   * @returns one entry per installed Agent, with Alpha's own store first.
   */
  sessionSources: () => Promise<SessionImportHarnessSourcesValue>
  /**
   * Import every Session under one source root, then refresh the Session list.
   * @param request - optional source-root override.
   * @returns the effective source root and one result per discovered Session.
   */
  importSessions: (request: SessionImportHarnessRequest) => Promise<SessionImportHarnessValue>
  /**
   * Export one local session as Markdown through the platform save path.
   * @param sessionId - Session to export.
   * @param title - session display title used for the default file name.
   */
  exportSession: (sessionId: string, title: string) => Promise<void>
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

/** One source Agent's presentation label key. */
const AGENT_KEY: Readonly<Record<SessionImportHarnessAgentSource['agent'], 'agent.dsh' | 'agent.codex' | 'agent.claude' | 'agent.zcode'>> = {
  dsh: 'agent.dsh',
  codex: 'agent.codex',
  claude: 'agent.claude',
  zcode: 'agent.zcode',
}

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

/**
 * Render the session management page.
 * @param props - composed slot props (see {@link ImportSessionsSectionProps}).
 * @returns the settings page element tree.
 */
export function ImportSessionsSection(props: ImportSessionsSectionProps): ReactNode {
  const { t, sessionSources, importSessions, exportSession, archiveSession, useSessions } = props
  const [sources, setSources] = useState<readonly SessionImportHarnessAgentSource[]>([])
  const [selected, setSelected] = useState('')
  const [ready, setReady] = useState(false)
  const [running, setRunning] = useState(false)
  const [value, setValue] = useState<SessionImportHarnessValue | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [exporting, setExporting] = useState<string | undefined>(undefined)
  const sessions = useSessions(state => state)
  // The inject face is rebuilt per registration, so the one-shot discovery must
  // not re-run when its identity changes.
  const readSources = useRef(sessionSources)
  readSources.current = sessionSources

  useEffect(() => {
    let cancelled = false
    readSources.current().then(
      (discovered) => {
        if (cancelled) return
        setSources(discovered.sources)
        setSelected(discovered.sources[0]?.sourceRoot ?? '')
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
    setRunning(true)
    setError(undefined)
    setValue(undefined)
    void importSessions({ sourceRoot: selected }).then(
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
    void exportSession(sessionId, title).then(
      () => { setExporting(undefined) },
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
      <div className={css.picker}>
        <label className={css.field} htmlFor="import-sessions-source-agent">
          <span className={css.label}>{t('sourceAgent')}</span>
          <select
            id="import-sessions-source-agent"
            className={`${css.input} ${css.selectInput}`}
            value={selected}
            aria-label={t('sourceAgent')}
            disabled={running || sources.length === 0}
            onChange={(event) => { setSelected(event.currentTarget.value) }}
          >
            {sources.map(source => (
              <option key={source.agent} value={source.sourceRoot}>
                {t(AGENT_KEY[source.agent])}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="primary"
          size="sm"
          disabled={running || !ready || sources.length === 0}
          onClick={runImport}
        >
          {running ? t('importing') : t('import')}
        </Button>
      </div>
      {!ready
        ? <p className={css.status}>{t('readingSources')}</p>
        : sources.length === 0 ? <p className={css.status}>{t('noAgents')}</p> : null}
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
