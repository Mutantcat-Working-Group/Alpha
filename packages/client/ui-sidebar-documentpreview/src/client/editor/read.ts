/** Complete-text reads for the editor: the page walk the text preview performs, to the file's end. */
import type { RemoteResult } from '@mutantcat/dsh-api-remotes/client'
import type { ReadWorkspaceFilePage, SessionFile } from '../rpc.ts'

/** One complete file read as text, with the version its first page reported. */
export interface EditorText {
  /** The complete file text; pages joined the way the Host splits them. */
  readonly text: string
  /** The version the first page reported, naming the text the save guard uses. */
  readonly version: string
}

/**
 * Read one complete file through the paged endpoint, injected so the face
 * stays host-free. A Remote call does not reject: the result carries the
 * failure. A version change between pages rejects through `drifted`, because
 * pages of two versions joined would show a file that never existed.
 * @param read - one page of lines, bound to the Client Remote.
 * @param file - Session and path decoded from the tab address.
 * @param signal - owning tab lifetime.
 * @param drifted - builds the error a mid-read version change reports.
 * @returns the complete text with its version, or the first declared failure.
 */
export async function readEditorText(
  read: ReadWorkspaceFilePage,
  file: SessionFile,
  signal: AbortSignal,
  drifted: () => Error,
): Promise<RemoteResult<EditorText>> {
  const pages: string[] = []
  let offset = 1
  let version: string | undefined
  for (;;) {
    const result = await read(file.sessionId, file.path, offset, signal)
    signal.throwIfAborted()
    if (!result.ok) return result
    const page = result.value
    if (version === undefined) version = page.version
    else if (page.version !== version) throw drifted()
    if (page.lines > 0) pages.push(page.text)
    if (page.eof) return { ok: true, value: { text: pages.join('\n'), version } }
    // A page reporting no lines without the end still advances the offset, so
    // an oddly paginated file cannot spin the walk.
    offset += Math.max(page.lines, 1)
  }
}

/** The complete-text read the editor performs. */
export type ReadEditorText = (
  file: SessionFile,
  signal: AbortSignal,
) => Promise<RemoteResult<EditorText>>
