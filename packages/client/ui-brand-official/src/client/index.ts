/** Official Alpha occupants for the generic browser-brand slots. */
import type { Context as ClientContext } from '@mutantcat/cordis'
import type {} from '@mutantcat/dsh-client-locale/client'
import type {} from '@mutantcat/dsh-client-ui-conversation/client'
import type {} from '@mutantcat/dsh-client-ui-renderer/client'
import type {} from '@mutantcat/dsh-client-ui-sidebar/client'
import type {} from '@mutantcat/dsh-client-ui-slots'
import { OfficialBrandMark, OfficialBrandName } from './Brand.tsx'
import { OfficialHeroBrandMark } from './HeroMark.tsx'
import type {} from './locales.ts'
import { en, zh } from './locales.ts'

/** Required services: the UI slot registry and the locale dictionary seat. */
export const inject = ['slots', 'locale']

/**
 * Fill the brand mark slots in every profile and the product name in official
 * builds, as one declaration-aware registration set. Local builds keep the
 * shell's local-build name label, which carries the version.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('sidebarBrand', { zh, en }))
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark', locale: 'sidebarBrand' }, OfficialBrandMark)
      if (process.env.DSH_CLIENT_BUILD_PROFILE === 'official') {
        yield ctx.slots.register({ name: 'sidebar.brand.name', locale: 'sidebarBrand' }, OfficialBrandName)
      }
    }))
  // The hero slot is declared by ui-conversation's factory, whose plugin
  // activates after the sidebar brand slots because it waits on more
  // services, so the hero occupant carries its own declaration wait.
  ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register({ name: 'conversation.hero.brand.mark', locale: 'sidebarBrand' }, OfficialHeroBrandMark))
}
