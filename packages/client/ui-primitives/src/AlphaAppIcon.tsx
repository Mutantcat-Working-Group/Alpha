import type { IconProps } from './icons/props.ts'

/** Raster asset backing {@link AlphaAppIcon}; served from the Web app dist root. */
const ALPHA_APP_ICON_SRC = '/alpha-mark.png'

/**
 * Render the Alpha application icon.
 *
 * The app icon is a raster asset rather than an inline mark because it carries
 * the product artwork; surfaces that ask for the brand mark instead get
 * {@link AlphaMark}.
 *
 * @param props.size - width and height in px (default 24).
 * @param props.className - extra class for layout placement.
 * @returns the icon image (aria-hidden; pair with the wordmark for accessibility).
 */
export function AlphaAppIcon({ size = 24, className }: IconProps) {
  return (
    <img
      width={size}
      height={size}
      className={className}
      src={ALPHA_APP_ICON_SRC}
      alt=""
      draggable={false}
      aria-hidden="true"
    />
  )
}
