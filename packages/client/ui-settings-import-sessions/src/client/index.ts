/** Harness chat-history import Settings page, browser half. */

import type { Context as ClientContext } from '@mutantcat/cordis'
import type {} from '@mutantcat/dsh-client-locale/client'
import type {} from '@mutantcat/dsh-client-ui-renderer/client'
import type {} from '@mutantcat/dsh-client-ui-settings/client'
// Type-only: pulls the `harnessSessionsImport` Context merge and the import face.
import type {} from '@mutantcat/dsh-api-session-controller/client'
// Type-only: pulls the `useSessions` global standard prop.
import type {} from '@mutantcat/dsh-client-ui-session/client'
// Type-only: pulls the `uiWorkspace` Context merge.
import type {} from '@mutantcat/dsh-client-ui-workspace/client'
import { ImportSessionsSection } from './ImportSessionsSection.tsx'
import type { ImportSessionsSectionInjected } from './ImportSessionsSection.tsx'
import { en, zh, type ImportSessionsLocaleKey } from './locales.ts'

export type { ImportSessionsSectionInjected, ImportSessionsSectionProps } from './ImportSessionsSection.tsx'
export type { ImportSessionsLocaleKey } from './locales.ts'

declare module '@mutantcat/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Harness chat-history import page copy. */
    'settings.importSessions': ImportSessionsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.importSessions'

/** Services required by the Settings registration and the import call. */
export const inject = ['slots', 'locale', 'harnessSessionsImport', 'uiWorkspace']

/** Contribute the session management page to Settings. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-import-sessions: dictionaries')

  const t = ctx.locale.bind(NS)
  const injected = (): ImportSessionsSectionInjected => ({
    sourceRoot: () => ctx.harnessSessionsImport.sourceRoot(),
    importSessions: request => ctx.harnessSessionsImport.importSessions(request),
    exportSession: sessionId => ctx.harnessSessionsImport.exportSession(sessionId),
    archiveSession: sessionId => ctx.uiWorkspace.archiveSession(sessionId as never),
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'import-sessions',
    order: 26,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, ImportSessionsSection))
}
