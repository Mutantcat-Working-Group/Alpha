import type { IconProps } from './icons/props.ts'

/** Native viewBox of {@link ALPHA_MARK_STROKES} (width and height in user units). */
export const ALPHA_MARK_VIEWBOX = { width: 24, height: 24 }

/**
 * The Alpha mark's strokes: two legs meeting at the apex and the crossbar
 * between them. Exported for consumers that compose their own svg around the
 * same geometry.
 */
export const ALPHA_MARK_STROKES = [
  'M12 3.2 L4.4 21',
  'M12 3.2 L19.6 21',
  'M8.6 14.6 L15.4 14.6',
] as const

/**
 * Render the Alpha mark.
 * @param props.size - width and height in px (default 24).
 * @param props.className - extra class for layout placement.
 * @returns the mark svg (aria-hidden; pair with the wordmark for accessibility).
 */
export function AlphaMark({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox={`0 0 ${ALPHA_MARK_VIEWBOX.width} ${ALPHA_MARK_VIEWBOX.height}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ALPHA_MARK_STROKES.map(d => <path key={d} d={d} />)}
    </svg>
  )
}
