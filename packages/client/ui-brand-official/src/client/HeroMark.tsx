/** Alpha mark occupant for the blank-session hero brand slot. */
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AlphaMark } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Render the Alpha mark ahead of the blank-session headline.
 * @param props - Host-supplied mark presentation.
 * @returns the Alpha mark.
 */
export function OfficialHeroBrandMark({ size, className }: HeroBrandMarkOwnerProps) {
  return <AlphaMark size={size} className={className} />
}
