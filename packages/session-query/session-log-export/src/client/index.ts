/** Browser plugin owning Session export download state and its shared modal. */

import type { Context as ClientContext } from '@mutantcat/cordis'
import type { SessionId } from '@mutantcat/dsh-session/types'
// Type-only: pulls the `harnessSessionsImport` Context merge the Markdown export calls.
import type {} from '@mutantcat/dsh-api-session-controller/client'
import type {} from '@mutantcat/dsh-client-locale/client'
import type {} from '@mutantcat/dsh-client-ui-commands/client'
import type {} from '@mutantcat/dsh-client-ui-conversation/client'
import type {} from '@mutantcat/dsh-client-ui-renderer/client'
import type {} from '@mutantcat/dsh-client-ui-session/client'
import { SessionLogDownloadController } from './controller.ts'
import type { SessionLogDownloadDialogInjected } from './Dialog.tsx'
import { SessionLogDownloadHeaderAction } from './HeaderAction.tsx'
import { en, NS, zh, type SessionLogDownloadKey } from './locales.ts'

declare module '@mutantcat/cordis' {
  interface Context {
    sessionLogDownload: SessionLogDownloadController
  }
}

declare module '@mutantcat/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'session-log-download': SessionLogDownloadKey
  }
}

export type { SessionLogDownloadEntry, SessionLogDownloadState } from './controller.ts'

/* jscpd:ignore-start -- per-consumer copy of the desktop save-bridge seam that
   ui-settings-import-sessions owns; the two plugins bundle independently and
   change on their own schedules. */
/** Desktop bridge seam that shows a native save dialog; absent in the browser. */
interface DesktopSaveBridge {
  dshDesktopBoot?: {
    saveMarkdown?: (filename: string, content: string) => Promise<string | null>
  }
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
 * Save one Markdown transcript: a native save dialog in the desktop shell, a browser download otherwise.
 * @param filename - default file name offered by the save dialog.
 * @param markdown - transcript body to write.
 */
async function saveMarkdown(filename: string, markdown: string): Promise<void> {
  const bridge = (globalThis as DesktopSaveBridge).dshDesktopBoot
  if (bridge?.saveMarkdown !== undefined) {
    await bridge.saveMarkdown(filename, markdown)
    return
  }
  downloadText(filename, markdown)
}
/* jscpd:ignore-end */

/** Services required by the Header contribution and the Markdown export. */
export const inject = ['slots', 'locale', 'harnessSessionsImport']

/**
 * Provide the download controller and mount its modal into the Session Header.
 * @param ctx - browser context carrying slots and locale services.
 */
export function apply(ctx: ClientContext): void {
  const controller = new SessionLogDownloadController()
  ctx.provide('sessionLogDownload', controller)
  ctx.effect(() => async () => { await controller.dispose() }, 'session-log-download: browser download lifecycle')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-log-download: browser dictionaries')
  ctx.on('command/executed', (sessionId, commandName, result) => {
    if (commandName === 'export' && result.kind === 'success') void controller.download(sessionId)
  })
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'session-log-download',
    locale: NS,
    inject: (): SessionLogDownloadDialogInjected => ({
      hooks: { sessionLogDownload: controller.store },
      request: (sessionId: SessionId) => controller.download(sessionId),
      dismiss: (sessionId: SessionId) => { controller.dismiss(sessionId) },
      exportMarkdown: async (sessionId: SessionId, title: string) => {
        const markdown = await ctx.harnessSessionsImport.exportSession(String(sessionId))
        await saveMarkdown(`${title}.md`, markdown)
      },
    }),
  }, SessionLogDownloadHeaderAction))
}

export type { SessionLogDownloadDialogInjected, SessionLogDownloadDialogProps } from './Dialog.tsx'
