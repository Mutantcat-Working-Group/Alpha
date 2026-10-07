/** The empty state a failed revision read leaves: the file's own reason and the retry. */
import type { ReactNode } from 'react'
import { Button, FileTypeIcon, classifyFileType } from '@mutantcat/dsh-client-ui-primitives'
import { pathPartsOf } from '@mutantcat/dsh-util-workspace-path'
import type { RevisionReadFailure } from './read-revision.ts'
import common from '../TextPreview.module.css'

/** Which body's read failed; the marker keeps each body's scenarios targeting the right node. */
export type ReadFailureMarker = 'editor' | 'textpreview'

/** The failed-read empty state shared by document bodies. */
export interface ReadFailureViewProps {
  /** The owning body, whose marker the empty state carries. */
  readonly marker: ReadFailureMarker
  /** The file address whose revision failed. */
  readonly resourceAddress: string
  /** The settled failure to display. */
  readonly failure: RevisionReadFailure
  /** Start a new revision, which reads again. */
  readonly reload: () => void
  /** The localized retry label. */
  readonly retry: string
}

/**
 * Show why a revision never loaded, with the reload that retries it.
 * @param props - the owning body's marker, the failed address, and the retry.
 * @returns the empty state rendered in place of the file.
 */
export function ReadFailureView({ marker, resourceAddress, failure, reload, retry }: ReadFailureViewProps): ReactNode {
  const { name } = pathPartsOf(resourceAddress)
  return (
    <div className={common.empty} {...marker === 'editor'
      ? { 'data-editor-failed': failure.code }
      : { 'data-textpreview-failed': failure.code }}>
      <FileTypeIcon kind={classifyFileType(name)} size={36} />
      <p className={common.emptyLine}>{failure.message}</p>
      <Button size="sm" onClick={reload}>{retry}</Button>
    </div>
  )
}
