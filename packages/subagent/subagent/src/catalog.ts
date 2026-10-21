/**
 * Parent-owned durable subagent catalog events and their chunked projection.
 *
 * @module @mutantcat/dsh-subagent/catalog
 */

import { z } from 'zod'
import { appendChunkedList, chunkedListSchema, iterateChunkedList } from '@mutantcat/dsh-chunked-list'
import type { ChunkedList } from '@mutantcat/dsh-chunked-list'
import type {
  Session,
  SessionEvent,
  SessionHeader,
  SessionId,
  SessionLogOffset,
} from '@mutantcat/dsh-session'
import type { ProjectionDefinition } from '@mutantcat/dsh-session-projection'
import type { SubagentCatalogEntry } from './projection-types.ts'

/** Payload version emitted when this process creates a child. */
export const SUBAGENT_CATALOG_VERSION = 0

/** Payload version for a child whose mode the historical evidence cannot name. */
const UNKNOWN_CHILD_CATALOG_VERSION = 1

/** Modes a locally created child records. */
type LocalCatalogMode =
  | { readonly mode: 'one-shot'; readonly label?: string }
  | { readonly mode: 'continuable'; readonly label: string }

/**
 * One complete parent-owned catalog fact. Version 0 records local creation,
 * version 1 additionally records a migrated child whose descriptor is missing
 * or unrecognized, and version 2 records an execution that ran outside a local
 * child Session.
 */
export type SubagentCatalogEvent =
  & {
    readonly childId: SessionId
    readonly childCreatedAt: number
  } & (
    | ({ readonly version: 0 } & LocalCatalogMode)
    | ({ readonly version: 1 } & (LocalCatalogMode | { readonly mode: 'unknown'; readonly label?: string }))
    | { readonly version: 2; readonly mode: 'external'; readonly label?: string }
  )

declare module '@mutantcat/dsh-session/types' {
  interface SessionEventMap {
    /**
     * A direct child's complete discovery fact.
     * @param data - versioned parent-owned catalog entry.
     */
    'subagent/catalog': SubagentCatalogEvent
  }
}

/** Host fold state for one parent catalog. */
export interface SubagentCatalogState {
  readonly inheritedEventCount: SessionLogOffset
  readonly head?: ChunkedList<SubagentCatalogEvent> | undefined
}

const sessionIdSchema = z.string() as unknown as z.ZodType<SessionId>
const localVersions = z.union([z.literal(SUBAGENT_CATALOG_VERSION), z.literal(UNKNOWN_CHILD_CATALOG_VERSION)])
const oneShotCatalogSchema = z.object({
  version: localVersions,
  childId: sessionIdSchema,
  childCreatedAt: z.number().int().nonnegative(),
  mode: z.literal('one-shot'),
  label: z.string().optional(),
}).strict()
const continuableCatalogSchema = z.object({
  version: localVersions,
  childId: sessionIdSchema,
  childCreatedAt: z.number().int().nonnegative(),
  mode: z.literal('continuable'),
  label: z.string(),
}).strict()
const unknownCatalogSchema = oneShotCatalogSchema.extend({
  version: z.literal(UNKNOWN_CHILD_CATALOG_VERSION),
  mode: z.literal('unknown'),
})
const externalCatalogSchema = oneShotCatalogSchema.extend({
  version: z.literal(2),
  mode: z.literal('external'),
})
const eventDataSchema = z.union([
  oneShotCatalogSchema,
  externalCatalogSchema,
  continuableCatalogSchema,
  unknownCatalogSchema,
]) as unknown as z.ZodType<SubagentCatalogEvent>
const catalogFactSchemas = [
  oneShotCatalogSchema,
  externalCatalogSchema,
  continuableCatalogSchema,
  unknownCatalogSchema,
] as const
const viewSchema = z.array(z.union(catalogFactSchemas.map(schema => schema
  .omit({ version: true, childId: true, childCreatedAt: true })
  .extend({
    id: sessionIdSchema,
    createdAt: schema.shape.childCreatedAt,
  })))) as unknown as z.ZodType<SubagentCatalogEntry[]>
const stateSchema: z.ZodType<SubagentCatalogState> = z.object({
  inheritedEventCount: z.number().int().nonnegative() as unknown as z.ZodType<SessionLogOffset>,
  head: chunkedListSchema(eventDataSchema).optional(),
}).strict()

declare module '@mutantcat/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    subagentCatalog: SubagentCatalogState
  }
}

/**
 * Materialize every complete direct-child fact, including migrated children
 * whose mode stayed unknown and executions outside a local child Session.
 * @param state - parent catalog fold state.
 * @returns current direct-child rows in parent catalog event order.
 */
function subagentCatalogEntries(state: SubagentCatalogState): SubagentCatalogEntry[] {
  return [...iterateChunkedList(state.head)].map((data) => {
    const { version: _version, childId, childCreatedAt, ...descriptor } = data
    return { id: childId, createdAt: childCreatedAt, ...descriptor }
  })
}

/** Parent-owned direct-child catalog projection; invalid own facts reject restoration. */
export const subagentCatalogProjectionDefinition = {
  key: 'subagentCatalog',
  stateSchema,
  init: (_header: SessionHeader, inheritedEventCount: SessionLogOffset) => ({ inheritedEventCount }),
  apply: (state, event: SessionEvent) => {
    if (event.type !== 'subagent/catalog' || event.seq < state.inheritedEventCount) return state
    return { ...state, head: appendChunkedList(state.head, eventDataSchema.parse(event.data)) }
  },
  stateVersion: 3,
  wire: { viewSchema, view: subagentCatalogEntries },
} satisfies ProjectionDefinition<'subagentCatalog', SubagentCatalogState>

/**
 * Append a complete direct-child discovery fact to its parent Session.
 * @param parent - durable direct parent receiving the discovery fact.
 * @param child - established child's immutable Session metadata.
 * @param descriptor - mode-discriminated creation label frozen with the child.
 */
export function establishCatalogChild(
  parent: Session,
  child: SessionHeader,
  descriptor:
    | { readonly mode: 'one-shot'; readonly label?: string }
    | { readonly mode: 'continuable'; readonly label: string },
): void {
  parent.append('subagent/catalog', descriptor.mode === 'one-shot'
    ? {
      version: SUBAGENT_CATALOG_VERSION,
      childId: child.id,
      childCreatedAt: child.createdAt,
      mode: descriptor.mode,
      ...descriptor.label === undefined ? {} : { label: descriptor.label },
    }
    : {
      version: SUBAGENT_CATALOG_VERSION,
      childId: child.id,
      childCreatedAt: child.createdAt,
      mode: descriptor.mode,
      label: descriptor.label,
    })
}
