import { AlphaAppIcon } from '@mutantcat/dsh-client-ui-primitives'
import type { PropsLocale } from '@mutantcat/dsh-client-ui-slots'
import type { SidebarBrandMarkOwnerProps } from '@mutantcat/dsh-client-ui-sidebar/client'
import type {} from './locales.ts'

/**
 * Render the Alpha application icon with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the Alpha app icon.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <AlphaAppIcon size={size} />
}

/**
 * Render the Alpha name without its independently slotted mark.
 * @param props - Localized copy seat for the brand namespace.
 * @returns the Alpha name.
 */
export function OfficialBrandName({ t }: PropsLocale<'sidebarBrand'>) {
  return <span>{t('name')}</span>
}
