// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionListState, SessionSummary } from '@mutantcat/dsh-api-session-controller/client'
import type {
  SessionImportHarnessAgentSource,
  SessionImportHarnessValue,
  SessionImportHarnessSourcesValue,
} from '@mutantcat/dsh-api-session-controller/types'
import type { SessionId } from '@mutantcat/dsh-session/types'
import { ImportSessionsSection } from '../src/client/ImportSessionsSection.tsx'
import type { ImportSessionsSectionProps } from '../src/client/ImportSessionsSection.tsx'
import { en, type ImportSessionsLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const sid = (id: string): SessionId => id as SessionId

function summary(id: string, title: string): SessionSummary {
  return { id: sid(id), displayTitle: title, running: false, paused: false, retainedBy: {}, blank: false, updatedAt: 0 }
}

function sessionState(sessions: readonly SessionSummary[]): SessionListState {
  return {
    ids: sessions.map(session => session.id),
    byId: Object.fromEntries(sessions.map(session => [session.id, session])),
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
  }
}

const t = ((key: ImportSessionsLocaleKey, params?: Record<string, string | number>): string =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    en[key],
  )) as ImportSessionsSectionProps['t']

/** One completed run over the given results. */
function value(results: SessionImportHarnessValue['results']): SessionImportHarnessValue {
  return { sourceRoot: '/source/sessions', results }
}

function props(options: {
  sources?: readonly SessionImportHarnessAgentSource[]
  sessionSources?: ImportSessionsSectionProps['sessionSources']
  importSessions?: ImportSessionsSectionProps['importSessions']
  exportSession?: ImportSessionsSectionProps['exportSession']
  archiveSession?: ImportSessionsSectionProps['archiveSession']
  sessions?: SessionListState
  useSessions?: ImportSessionsSectionProps['useSessions']
} = {}): ImportSessionsSectionProps {
  const sources = options.sources ?? [{ agent: 'dsh' as const, sourceRoot: '/source/sessions' }]
  return {
    t,
    sessionSources: options.sessionSources ?? (async () => ({ sources })),
    importSessions: options.importSessions ?? (async () => value([])),
    exportSession: options.exportSession ?? (async () => {}),
    archiveSession: options.archiveSession ?? (async () => {}),
    useSessions: options.useSessions
      ?? ((select: (state: SessionListState) => unknown) => select(options.sessions ?? sessionState([]))),
  } as unknown as ImportSessionsSectionProps
}

describe('ImportSessionsSection', () => {
  it('selects the first installed Agent and imports its sessions on request', async () => {
    const importSessions = vi.fn(async () => value([
      { sourcePath: '/source/sessions/project/one', sessionId: sid('one'), status: 'imported' as const },
    ]))
    render(<ImportSessionsSection {...props({
      sources: [
        { agent: 'dsh', sourceRoot: '/configured/sessions' },
        { agent: 'codex', sourceRoot: '/home/.codex' },
      ],
      importSessions,
    })} />)

    const picker = await screen.findByLabelText(en.sourceAgent) as HTMLSelectElement
    await waitFor(() => { expect(picker.value).toBe('/configured/sessions') })

    fireEvent.click(screen.getByRole('button', { name: en.import }))

    await waitFor(() => { expect(importSessions).toHaveBeenCalledWith({ sourceRoot: '/configured/sessions' }) })
    expect(screen.getByRole('option', { name: en['agent.dsh'] })).toBeTruthy()
    expect(screen.getByRole('option', { name: en['agent.codex'] })).toBeTruthy()
    expect(await screen.findByText(en['status.imported'])).toBeTruthy()
    expect(screen.getByText(en.resultSession.replace('{id}', 'one'))).toBeTruthy()
    expect(screen.getByText(en.summary
      .replace('{total}', '1').replace('{imported}', '1')
      .replace('{alreadyPresent}', '0').replace('{refused}', '0'))).toBeTruthy()
  })

  it('imports the Agent the user picks', async () => {
    const importSessions = vi.fn(async () => value([]))
    render(<ImportSessionsSection {...props({
      sources: [
        { agent: 'dsh', sourceRoot: '/source/sessions' },
        { agent: 'claude', sourceRoot: '/home/.claude' },
      ],
      importSessions,
    })} />)

    const picker = await screen.findByLabelText(en.sourceAgent) as HTMLSelectElement
    fireEvent.change(picker, { target: { value: '/home/.claude' } })
    fireEvent.click(screen.getByRole('button', { name: en.import }))
    await waitFor(() => { expect(importSessions).toHaveBeenCalledWith({ sourceRoot: '/home/.claude' }) })
  })

  it('reports an empty source directory and a refusal reason', async () => {
    render(<ImportSessionsSection {...props({
      importSessions: async () => value([
        { sourcePath: '/source/sessions/broken/two', status: 'refused', reason: 'unknown format version 9' },
        { sourcePath: '/source/sessions/project/three', sessionId: sid('three'), status: 'already-present' },
      ]),
    })} />)

    await screen.findByLabelText(en.sourceAgent)
    fireEvent.click(screen.getByRole('button', { name: en.import }))

    expect(await screen.findByText(en['status.refused'])).toBeTruthy()
    expect(screen.getByText(en['status.alreadyPresent'])).toBeTruthy()
    expect(screen.getByText(en.refusedReason.replace('{reason}', 'unknown format version 9'))).toBeTruthy()
    expect(screen.getByText('/source/sessions/broken/two')).toBeTruthy()
    expect(screen.getByRole('list', { name: en.results })).toBeTruthy()
  })

  it('shows the empty-source message when the scan finds nothing', async () => {
    render(<ImportSessionsSection {...props()} />)

    await screen.findByLabelText(en.sourceAgent)
    fireEvent.click(screen.getByRole('button', { name: en.import }))

    expect(await screen.findByText(en.emptyResults)).toBeTruthy()
  })

  it('offers no import and names the cause when no Agent is installed', async () => {
    render(<ImportSessionsSection {...props({ sources: [] })} />)

    expect(await screen.findByText(en.noAgents)).toBeTruthy()
    expect(screen.queryByText(en.readingSources)).toBeNull()
    expect(screen.getByRole('button', { name: en.import }).hasAttribute('disabled')).toBe(true)
  })

  it('surfaces a failed call and stays usable', async () => {
    const importSessions = vi.fn(async () => { throw new Error('gateway unavailable') })
    render(<ImportSessionsSection {...props({ importSessions })} />)

    await screen.findByLabelText(en.sourceAgent)
    fireEvent.click(screen.getByRole('button', { name: en.import }))

    expect(await screen.findByText(en.failed.replace('{message}', 'gateway unavailable'))).toBeTruthy()
    expect(screen.getByRole('button', { name: en.import }).hasAttribute('disabled')).toBe(false)
  })

  it('reports a hostile rejection that is not an Error', async () => {
    render(<ImportSessionsSection {...props({
      importSessions: async () => { throw 'gateway offline' },
    })} />)

    await screen.findByLabelText(en.sourceAgent)
    fireEvent.click(screen.getByRole('button', { name: en.import }))

    expect(await screen.findByText(en.failed.replace('{message}', 'gateway offline'))).toBeTruthy()
  })

  it('ignores a discovery read that settles after the page unmounts', async () => {
    const settles: Array<{
      done: (value: SessionImportHarnessSourcesValue) => void
      fail: (reason: unknown) => void
    }> = []
    const pending = (): Promise<SessionImportHarnessSourcesValue> =>
      new Promise<SessionImportHarnessSourcesValue>((done, fail) => {
        settles.push({ done, fail })
      })
    const resolved = render(<ImportSessionsSection {...props({ sessionSources: pending })} />)
    const rejected = render(<ImportSessionsSection {...props({ sessionSources: pending })} />)
    resolved.unmount()
    rejected.unmount()

    settles[0]!.done({ sources: [{ agent: 'dsh', sourceRoot: '/configured/sessions' }] })
    settles[1]!.fail(new Error('remote session unavailable'))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(screen.queryByLabelText(en.sourceAgent)).toBeNull()
  })

  it('surfaces a failed discovery read and offers no import', async () => {
    const importSessions = vi.fn(async () => value([]))
    render(<ImportSessionsSection {...props({
      sessionSources: async () => { throw new Error('remote session unavailable') },
      importSessions,
    })} />)

    expect(await screen.findByText(en.failed.replace('{message}', 'remote session unavailable'))).toBeTruthy()
    // Discovery named no Agent, so neither the picker nor the import is offered.
    const picker = screen.getByLabelText(en.sourceAgent) as HTMLSelectElement
    expect(picker.hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: en.import }).hasAttribute('disabled')).toBe(true)
    expect(importSessions).not.toHaveBeenCalled()
  })

  it('exports a listed session with its id and title', async () => {
    const exportSession = vi.fn(async () => {})
    render(<ImportSessionsSection {...props({
      exportSession,
      sessions: sessionState([summary('one', 'One')]),
    })} />)

    fireEvent.click(await screen.findByRole('button', { name: en.exportNamed.replace('{title}', 'One') }))
    await waitFor(() => { expect(exportSession).toHaveBeenCalledWith('one', 'One') })
  })

  it('surfaces an export failure', async () => {
    const exportSession = vi.fn(async () => { throw new Error('export blew up') })
    render(<ImportSessionsSection {...props({
      exportSession,
      sessions: sessionState([summary('one', 'One')]),
    })} />)

    fireEvent.click(await screen.findByRole('button', { name: en.exportNamed.replace('{title}', 'One') }))
    expect(await screen.findByText(en.failed.replace('{message}', 'export blew up'))).toBeTruthy()
  })
})
