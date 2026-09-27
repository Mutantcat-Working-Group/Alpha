/**
 * Glyphs this package draws that the shared icon set does not carry yet.
 * Same props contract as `@mutantcat/dsh-client-ui-primitives` icons, so a
 * shared replacement is a one-line import change.
 *
 * The wrap control swaps between the two glyphs below to preview the mode a
 * click switches to, so neither needs a pressed style.
 */
import type { IconProps } from '@mutantcat/dsh-client-ui-primitives'

/** Two margin bars, a straight arrow running to the right one: lines run past the edge. */
export const IconNowrapFill16 = ({ size = 16, className }: IconProps) => (
  <svg
    width={size}
    height={size}
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M1.5 2.5H3.5V21.5H1.5V2.5ZM20.5 2.5H22.5V21.5H20.5V2.5ZM14 9L19 12L14 15V13H5V11H14V9Z"
      fill="currentColor"
    />
  </svg>
)

/** Two margin bars, an arrow sweeping around and back left: lines turn under themselves. */
export const IconWrapFill16 = ({ size = 16, className }: IconProps) => (
  <svg
    width={size}
    height={size}
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M1.5 2.5H3.5V21.5H1.5V2.5ZM20.5 2.5H22.5V21.5H20.5V2.5ZM6.75 5H11.5A6 6 0 0 1 12 16.98V19L7 16L12 13V14.97A4 4 0 0 0 11.5 7H6.75V5Z"
      fill="currentColor"
    />
  </svg>
)

/** A floppy-disk silhouette: the save control in the editor's strip. */
export const IconSaveFill16 = ({ size = 16, className }: IconProps) => (
  <svg
    width={size}
    height={size}
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7M7 3v4a1 1 0 0 0 1 1h7"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)
