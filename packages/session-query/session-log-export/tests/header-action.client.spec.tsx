// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@mutantcat/dsh-session/types'
import { SessionLogDownloadController } from '../src/client/controller.ts'
import { SessionLogDownloadHeaderAction } from '../src/client/HeaderAction.tsx'
import type { SessionLogDownloadDialogProps } from '../src/client/Dialog.tsx'
import { en } from '../src/client/locales.ts'

const SID = 'session-export-header' as SessionId

function bindSessionExport(controller: SessionLogDownloadController) {
  return function useSessionLogDownload<T>(selector: (state: ReturnType<typeof controller.store.getSnapshot>) => T): T {
    return useSyncExternalStore(
      listener => controller.store.subscribe(listener),
      () => selector(controller.store.getSnapshot()),
    )
  }
}

interface BenchOptions {
  summary?: { displayTitle?: string }
  exportMarkdown?: (sessionId: SessionId, title: string) => Promise<void>
}

function bench(options: BenchOptions = {}) {
  const controller = new SessionLogDownloadController(async () => new Response('zip'), vi.fn())
  const request = vi.fn((sessionId: SessionId) => controller.download(sessionId))
  const dismiss = vi.fn((sessionId: SessionId) => { controller.dismiss(sessionId) })
  const useSessionLogDownload = bindSessionExport(controller)
  const useSessions = <T,>(select: (state: { byId: Record<string, { displayTitle?: string } | undefined> }) => T): T =>
    select({ byId: { [SID]: options.summary } })
  const exportMarkdown = options.exportMarkdown ?? vi.fn(async () => {})
  const props = {
    sessionId: SID,
    useSessionLogDownload,
    useSessions,
    request,
    dismiss,
    exportMarkdown,
    t: (key: keyof typeof en): string => en[key],
  } as unknown as SessionLogDownloadDialogProps
  const view = render(<SessionLogDownloadHeaderAction {...props} />)
  return { controller, request, view, exportMarkdown }
}

afterEach(cleanup)

describe('Session export Header action', () => {
  it('opens the more-actions menu and downloads through the shared controller', async () => {
    const b = bench()
    const button = b.view.getByRole('button', { name: 'More actions' })
    expect(button.querySelector('svg')).not.toBeNull()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Download session log' }))
    await waitFor(() => { expect(b.request).toHaveBeenCalledWith(SID) })
    expect(b.view.queryByRole('menuitem', { name: 'Download session log' })).toBeNull()
    expect(await b.view.findByRole('dialog', { name: 'Session download started' })).toBeTruthy()
  })

  it('closes the menu on Escape without downloading', () => {
    const b = bench()
    fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
    expect(b.view.getByRole('menuitem', { name: 'Download session log' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(b.view.queryByRole('menuitem', { name: 'Download session log' })).toBeNull()
    expect(b.request).not.toHaveBeenCalled()
  })

  it('disables the download row while either entry path downloads this Session', async () => {
    const b = bench()
    let release!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { release = resolve })
    const controller = new SessionLogDownloadController(() => pending, vi.fn())
    const useSessionLogDownload = bindSessionExport(controller)
    b.view.rerender(<SessionLogDownloadHeaderAction {...({
      sessionId: SID,
      useSessionLogDownload,
      useSessions: () => undefined,
      request: (sessionId: SessionId) => controller.download(sessionId),
      dismiss: (sessionId: SessionId) => { controller.dismiss(sessionId) },
      exportMarkdown: vi.fn(async () => {}),
      t: (key: keyof typeof en): string => en[key],
    } as unknown as SessionLogDownloadDialogProps)} />)

    const download = controller.download(SID)
    const button = b.view.getByRole('button', { name: 'More actions' })
    await waitFor(() => { expect(button.getAttribute('aria-busy')).toBe('true') })
    fireEvent.click(button)
    const item = b.view.getByRole('menuitem', { name: 'Download session log' })
    expect((item as HTMLButtonElement).disabled).toBe(true)
    release(new Response('zip'))
    await download
    await waitFor(() => { expect(button.getAttribute('aria-busy')).toBe('false') })
    expect((item as HTMLButtonElement).disabled).toBe(false)
  })

  it('exports the Session as Markdown and holds the row until the save settles', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    const exportMarkdown = vi.fn((_sessionId: SessionId, _title: string) => pending)
    const b = bench({ summary: { displayTitle: 'Export header' }, exportMarkdown })
    fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Export to Markdown' }))
    expect(b.exportMarkdown).toHaveBeenCalledWith(SID, 'Export header')

    // Selection closes the menu, so the in-flight state is read from a reopened list.
    fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
    const item = b.view.getByRole('menuitem', { name: 'Export to Markdown' }) as HTMLButtonElement
    expect(item.disabled).toBe(true)
    release()
    await pending
    await waitFor(() => { expect(item.disabled).toBe(false) })
  })

  it('names the Markdown file after the Session id when the header has no title', async () => {
    const b = bench()
    fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Export to Markdown' }))
    expect(b.exportMarkdown).toHaveBeenCalledWith(SID, String(SID))
  })

  it('restores the Markdown row after a rejected export', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const b = bench({ exportMarkdown: vi.fn(async () => { throw new Error('save failed') }) })
    fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Export to Markdown' }))
    await waitFor(() => { expect(warn).toHaveBeenCalled() })
    fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
    expect((b.view.getByRole('menuitem', { name: 'Export to Markdown' }) as HTMLButtonElement).disabled).toBe(false)
    warn.mockRestore()
  })
})
