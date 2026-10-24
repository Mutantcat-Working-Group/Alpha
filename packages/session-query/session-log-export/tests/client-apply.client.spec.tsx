// @vitest-environment jsdom
import { Context } from '@mutantcat/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@mutantcat/dsh-client-ui-renderer/client'
import type { SessionId } from '@mutantcat/dsh-session/types'
import { LocaleRuntime } from '@mutantcat/dsh-client-locale/client'
import type {} from '@mutantcat/dsh-client-ui-conversation/client'
import { SessionLogDownloadHeaderAction } from '../src/client/HeaderAction.tsx'
import { apply, inject } from '../src/client/index.ts'

const SID = 'session-export-apply' as SessionId

afterEach(() => { vi.unstubAllGlobals() })

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declaration = declare(slots)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const exportSession = vi.fn(async () => '# Export')
  ctx.provide('harnessSessionsImport', {
    sourceRoot: vi.fn(async () => '/source/sessions'),
    sessionSources: vi.fn(async () => ({ sources: [] })),
    importSessions: vi.fn(async () => ({ sourceRoot: '/source/sessions', results: [] })),
    exportSession,
  })
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, declaration, fiber, exportSession }
}

describe('session-log-download browser plugin', () => {
  it('provides one controller and removes its Header contribution on disposal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })))
    const b = await bench()
    expect(inject).toEqual(['slots', 'locale', 'harnessSessionsImport'])
    expect(b.ctx.sessionLogDownload).toBeDefined()
    expect(b.slots.entries('conversation.session.header.actions')).toHaveLength(0)
    const entry = b.slots.entries('conversation.session.header.utilities')[0]
    expect(entry?.component).toBe(SessionLogDownloadHeaderAction)
    expect(entry?.options).toMatchObject({ id: 'session-log-download' })
    const injected = (entry?.inject as unknown as () => import('../src/client/Dialog.tsx').SessionLogDownloadDialogInjected)()
    await injected.request(SID)
    expect(b.ctx.sessionLogDownload.store.getSnapshot().bySession[SID]?.status).toBe('error')
    injected.dismiss(SID)
    expect(b.ctx.sessionLogDownload.store.getSnapshot().bySession[SID]?.open).toBe(false)

    await b.fiber.dispose()
    expect(b.slots.entries('conversation.session.header.utilities')).toHaveLength(0)
  })

  it('downloads only for an export execution acknowledged by this browser client', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 500 }))
    vi.stubGlobal('fetch', fetcher)
    const first = await bench()
    const second = await bench()

    first.ctx.emit('command/executed', SID, 'plan', { kind: 'success' })
    expect(fetcher).not.toHaveBeenCalled()
    first.ctx.emit('command/executed', SID, 'export', { kind: 'error', text: 'bad path' })
    expect(fetcher).not.toHaveBeenCalled()
    first.ctx.emit('command/executed', SID, 'export', { kind: 'success' })
    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalledOnce()
      expect(first.ctx.sessionLogDownload.store.getSnapshot().bySession[SID]?.status).toBe('error')
    })
    expect(second.ctx.sessionLogDownload.store.getSnapshot().bySession[SID]).toBeUndefined()

    await first.fiber.dispose()
    await second.fiber.dispose()
  })

  it('re-registers after the declaring Header slot collapses and returns', async () => {
    const b = await bench()
    b.declaration()
    expect(b.slots.entries('conversation.session.header.utilities')).toHaveLength(0)
    const redeclare = declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('conversation.session.header.utilities')[0]?.component).toBe(SessionLogDownloadHeaderAction)
    redeclare()
    await b.fiber.dispose()
  })

  it('exports a Session as Markdown through the desktop native save dialog', async () => {
    const b = await bench()
    const entry = b.slots.entries('conversation.session.header.utilities')[0]
    const injected = (entry?.inject as unknown as () => import('../src/client/Dialog.tsx').SessionLogDownloadDialogInjected)()

    const saveMarkdown = vi.fn(async () => '/picked/Report.md')
    ;(globalThis as { dshDesktopBoot?: unknown }).dshDesktopBoot = { saveMarkdown }
    try {
      await injected.exportMarkdown(SID, 'Report')
      expect(b.exportSession).toHaveBeenCalledWith(String(SID))
      expect(saveMarkdown).toHaveBeenCalledWith('Report.md', '# Export')
    } finally {
      delete (globalThis as { dshDesktopBoot?: unknown }).dshDesktopBoot
    }
    await b.fiber.dispose()
  })

  it('treats a cancelled native save dialog as a no-op', async () => {
    const b = await bench()
    const entry = b.slots.entries('conversation.session.header.utilities')[0]
    const injected = (entry?.inject as unknown as () => import('../src/client/Dialog.tsx').SessionLogDownloadDialogInjected)()

    ;(globalThis as { dshDesktopBoot?: unknown }).dshDesktopBoot = { saveMarkdown: vi.fn(async () => null) }
    try {
      await expect(injected.exportMarkdown(SID, 'Report')).resolves.toBeUndefined()
      expect(b.exportSession).toHaveBeenCalledWith(String(SID))
    } finally {
      delete (globalThis as { dshDesktopBoot?: unknown }).dshDesktopBoot
    }
    await b.fiber.dispose()
  })

  it('falls back to a browser download when the desktop bridge is absent', async () => {
    const b = await bench()
    const entry = b.slots.entries('conversation.session.header.utilities')[0]
    const injected = (entry?.inject as unknown as () => import('../src/client/Dialog.tsx').SessionLogDownloadDialogInjected)()

    const createObjectURL = vi.fn(() => 'blob:report')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      await injected.exportMarkdown(SID, 'Report')
      expect(createObjectURL).toHaveBeenCalled()
      expect(click).toHaveBeenCalled()
      expect(revokeObjectURL).toHaveBeenCalled()
    } finally {
      delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL
      delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL
      click.mockRestore()
    }
    await b.fiber.dispose()
  })

  it('propagates a failed Markdown export to the Header action', async () => {
    const b = await bench()
    const entry = b.slots.entries('conversation.session.header.utilities')[0]
    const injected = (entry?.inject as unknown as () => import('../src/client/Dialog.tsx').SessionLogDownloadDialogInjected)()

    b.exportSession.mockRejectedValueOnce(new Error('boom'))
    await expect(injected.exportMarkdown(SID, 'Report')).rejects.toThrow('boom')
    await b.fiber.dispose()
  })
})
