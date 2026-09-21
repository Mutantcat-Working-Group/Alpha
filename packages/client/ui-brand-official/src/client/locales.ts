/** Copy owned by the official brand occupants. */
import type {} from '@mutantcat/dsh-client-ui-slots'

declare module '@mutantcat/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    sidebarBrand: keyof typeof zh
  }
}

/** Simplified Chinese brand copy. */
export const zh = {
  name: 'Alpha',
} satisfies Record<string, string>

/** English brand copy. */
export const en = {
  name: 'Alpha',
} satisfies Record<keyof typeof zh, string>
