import { AlphaMark } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from './locales.ts'

/**
 * Render the Alpha mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the Alpha mark.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <AlphaMark size={size} />
}

/**
 * Render the Alpha name without its independently slotted mark.
 * @param props - Localized copy seat for the brand namespace.
 * @returns the Alpha name.
 */
export function OfficialBrandName({ t }: PropsLocale<'sidebarBrand'>) {
  return <span>{t('name')}</span>
}
