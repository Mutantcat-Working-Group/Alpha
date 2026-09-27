/** Shared indeterminate loading feedback for document reads and rendering. */
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { StateDot } from '@mutantcat/dsh-client-ui-primitives'
import css from './LoadingIndicator.module.css'

/**
 * @param props - localized status label, compact inline placement for additional pages, and an optional caller class for local layout.
 * @returns a centered document loading status or an accessible inline spinner.
 */
export function LoadingIndicator({ label, inline = false, className }: {
  label: string
  inline?: boolean
  className?: string | undefined
}): ReactNode {
  return <span className={clsx(css.loading, inline && css.inline, className)} role="status" aria-label={label} data-document-loading>
    <StateDot state="ongoing" size={inline ? 14 : 28} />
    {!inline && <span>{label}</span>}
  </span>
}
