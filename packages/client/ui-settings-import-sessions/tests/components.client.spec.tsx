// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionImportHarnessValue } from '@mutantcat/dsh-api-session-controller/types'
import type { SessionId } from '@mutantcat/dsh-session/types'
import { ImportSessionsSection } from '../src/client/ImportSessionsSection.tsx'
import type { ImportSessionsSectionProps } from '../src/client/ImportSessionsSection.tsx'
import { en, type ImportSessionsLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const sid = (id: string): SessionId => id as SessionId

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
  configured?: string
  sourceRoot?: () => Promise<string>
  importSessions?: ImportSessionsSectionProps['importSessions']
} = {}): ImportSessionsSectionProps {
  return {
    t,
    sourceRoot: options.sourceRoot ?? (async () => options.configured ?? '/source/sessions'),
    importSessions: options.importSessions ?? (async () => value([])),
  } as unknown as ImportSessionsSectionProps
}

describe('ImportSessionsSection', () => {
  it('prefills the configured source root and imports that root on request', async () => {
    const importSessions = vi.fn(async () => value([
      { sourcePath: '/source/sessions/project/one', sessionId: sid('one'), status: 'imported' as const },
    ]))
    render(<ImportSessionsSection {...props({ configured: '/configured/sessions', importSessions })} />)

    const field = await screen.findByLabelText(en.sourceRoot) as HTMLInputElement
    await waitFor(() => { expect(field.value).toBe('/configured/sessions') })

    fireEvent.click(screen.getByRole('button', { name: en.import }))

    await waitFor(() => { expect(importSessions).toHaveBeenCalledWith({ sourceRoot: '/configured/sessions' }) })
    expect(await screen.findByText(en['status.imported'])).toBeTruthy()
    expect(screen.getByText(en.resultSession.replace('{id}', 'one'))).toBeTruthy()
    expect(screen.getByText(en.summary
      .replace('{total}', '1').replace('{imported}', '1')
      .replace('{alreadyPresent}', '0').replace('{refused}', '0'))).toBeTruthy()
  })

  it('imports the root the user edits and omits an emptied field', async () => {
    const importSessions = vi.fn(async () => value([]))
    render(<ImportSessionsSection {...props({ importSessions })} />)

    const field = await screen.findByLabelText(en.sourceRoot) as HTMLInputElement
    fireEvent.change(field, { target: { value: '/elsewhere/sessions' } })
    fireEvent.click(screen.getByRole('button', { name: en.import }))
    await waitFor(() => { expect(importSessions).toHaveBeenCalledWith({ sourceRoot: '/elsewhere/sessions' }) })

    fireEvent.change(field, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: en.import }))
    await waitFor(() => { expect(importSessions).toHaveBeenLastCalledWith({}) })
  })

  it('reports an empty source directory and a refusal reason', async () => {
    render(<ImportSessionsSection {...props({
      importSessions: async () => value([
        { sourcePath: '/source/sessions/broken/two', status: 'refused', reason: 'unknown format version 9' },
        { sourcePath: '/source/sessions/project/three', sessionId: sid('three'), status: 'already-present' },
      ]),
    })} />)

    await screen.findByLabelText(en.sourceRoot)
    fireEvent.click(screen.getByRole('button', { name: en.import }))

    expect(await screen.findByText(en['status.refused'])).toBeTruthy()
    expect(screen.getByText(en['status.alreadyPresent'])).toBeTruthy()
    expect(screen.getByText(en.refusedReason.replace('{reason}', 'unknown format version 9'))).toBeTruthy()
    expect(screen.getByText('/source/sessions/broken/two')).toBeTruthy()
    expect(screen.getByRole('list', { name: en.results })).toBeTruthy()
  })

  it('shows the empty-source message when the scan finds nothing', async () => {
    render(<ImportSessionsSection {...props()} />)

    await screen.findByLabelText(en.sourceRoot)
    fireEvent.click(screen.getByRole('button', { name: en.import }))

    expect(await screen.findByText(en.emptyResults)).toBeTruthy()
  })

  it('surfaces a failed call and stays usable', async () => {
    const importSessions = vi.fn(async () => { throw new Error('gateway unavailable') })
    render(<ImportSessionsSection {...props({ importSessions })} />)

    await screen.findByLabelText(en.sourceRoot)
    fireEvent.click(screen.getByRole('button', { name: en.import }))

    expect(await screen.findByText(en.failed.replace('{message}', 'gateway unavailable'))).toBeTruthy()
    expect(screen.getByRole('button', { name: en.import }).hasAttribute('disabled')).toBe(false)
  })

  it('reports a hostile rejection that is not an Error', async () => {
    render(<ImportSessionsSection {...props({
      importSessions: async () => { throw 'gateway offline' },
    })} />)

    await screen.findByLabelText(en.sourceRoot)
    fireEvent.click(screen.getByRole('button', { name: en.import }))

    expect(await screen.findByText(en.failed.replace('{message}', 'gateway offline'))).toBeTruthy()
  })

  it('ignores a configured-root read that settles after the page unmounts', async () => {
    const settles: Array<{ done: (value: string) => void; fail: (reason: unknown) => void }> = []
    const pending = (): Promise<string> => new Promise<string>((done, fail) => {
      settles.push({ done, fail })
    })
    const resolved = render(<ImportSessionsSection {...props({ sourceRoot: pending })} />)
    const rejected = render(<ImportSessionsSection {...props({ sourceRoot: pending })} />)
    resolved.unmount()
    rejected.unmount()

    settles[0]!.done('/configured/sessions')
    settles[1]!.fail(new Error('remote session unavailable'))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(screen.queryByLabelText(en.sourceRoot)).toBeNull()
  })

  it('surfaces a failed configured-root read and lets the user type one instead', async () => {
    const importSessions = vi.fn(async () => value([]))
    render(<ImportSessionsSection {...props({
      sourceRoot: async () => { throw new Error('remote session unavailable') },
      importSessions,
    })} />)

    expect(await screen.findByText(en.failed.replace('{message}', 'remote session unavailable'))).toBeTruthy()
    const field = screen.getByLabelText(en.sourceRoot) as HTMLInputElement
    fireEvent.change(field, { target: { value: '/typed/sessions' } })
    fireEvent.click(screen.getByRole('button', { name: en.import }))
    await waitFor(() => { expect(importSessions).toHaveBeenCalledWith({ sourceRoot: '/typed/sessions' }) })
  })
})
