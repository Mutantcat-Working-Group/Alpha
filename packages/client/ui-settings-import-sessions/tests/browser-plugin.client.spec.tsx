// @vitest-environment jsdom
import { Context } from '@mutantcat/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@mutantcat/dsh-client-locale/client'
import { SlotRegistry } from '@mutantcat/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@mutantcat/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@mutantcat/dsh-client-test-runtime'
import type { SessionImportHarnessValue } from '@mutantcat/dsh-api-session-controller/types'
import { apply, inject } from '../src/client/index.ts'
import { ImportSessionsSection } from '../src/client/ImportSessionsSection.tsx'
import type { ImportSessionsSectionInjected } from '../src/client/ImportSessionsSection.tsx'
import { apply as hostApply } from '../src/index.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const sourceRoot = vi.fn(async () => '/source/sessions')
  const importSessions = vi.fn(async (): Promise<SessionImportHarnessValue> => ({
    sourceRoot: '/source/sessions',
    results: [],
  }))
  const exportSession = vi.fn(async () => '# Export')
  const archiveSession = vi.fn(async () => {})
  ctx.provide('harnessSessionsImport', { sourceRoot, importSessions, exportSession })
  ctx.provide('uiWorkspace', { archiveSession })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, sourceRoot, importSessions, exportSession, archiveSession }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-import-sessions browser plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the services used by the page and the import', () => {
    expect(inject).toEqual(['slots', 'locale', 'harnessSessionsImport', 'uiWorkspace'])
  })

  it('registers the import page after archived sessions with localized copy', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(ImportSessionsSection)
    expect(entry.options).toMatchObject({ id: 'import-sessions', order: 26 })
    expect(entry.locale).toBe('settings.importSessions')
    expect(resolveSlotLabel(entry.options.label)).toBe('会话管理')

    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('Session management')

    const injected = (entry.inject as unknown as () => ImportSessionsSectionInjected)()
    await expect(injected.sourceRoot()).resolves.toBe('/source/sessions')
    await expect(injected.importSessions({ sourceRoot: '/other/sessions' }))
      .resolves.toMatchObject({ sourceRoot: '/source/sessions' })
    expect(b.sourceRoot).toHaveBeenCalled()
    expect(b.importSessions).toHaveBeenCalledWith({ sourceRoot: '/other/sessions' })
    await b.ctx.fiber.dispose()
  })

  it('follows a late declaration and a declarer reload', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.section')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })

    stop()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.section')[0]?.component).toBe(ImportSessionsSection)
    })

    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(() => b.locale.register('settings.importSessions', 'zh', {})).not.toThrow()
    await b.ctx.fiber.dispose()
  })
})
