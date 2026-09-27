import { composeError, Context } from '@mutantcat/cordis'
import { isNonNullable, type Dict } from '@mutantcat/cosmokit'
import { Entry, type EntryOptions } from './entry.ts'
import { EntryGroup } from './group.ts'

/** Scope the harness packages published under before the rename. */
const LEGACY_SCOPE = '@deepseek-ai/'

/** Scope the harness packages this repository publishes under. */
const SCOPE = '@mutantcat/'

/** Suffixes of the external engine family, which keeps its registry scope. */
const EXTERNAL_ENGINE = /^libreoffice-kit(?:-|[/@]|$)/

/**
 * Name a loader entry's specifier under the scope the harness now publishes under.
 *
 * A plugin published against the pre-rescope scope names both itself and its
 * dependencies with `@deepseek-ai/`, and its config row reaches
 * {@link EntryTree.import} verbatim, so every such row would fail to import.
 * The external engine family keeps its registry scope: those packages come from
 * the registry, not from this repository, so rewriting them would name a
 * package that does not exist.
 *
 * @param name - the specifier a loader entry declares.
 * @returns The specifier to import.
 */
function rescopeSpecifier(name: string): string {
  if (!name.startsWith(LEGACY_SCOPE)) return name
  const suffix = name.slice(LEGACY_SCOPE.length)
  if (EXTERNAL_ENGINE.test(suffix)) return name
  return `${SCOPE}${suffix}`
}

/** Mutable tree of loader entries. Persistence is supplied by subclasses. */
export abstract class EntryTree {
  static readonly sep = ':'

  public ctx: Context
  public enableLogs?: boolean
  public root: EntryGroup
  public store: Dict<Entry> = Object.create(null)

  constructor(ctx: Context) {
    this.ctx = ctx.extend({ baseUrl: ctx.baseUrl })
    this.root = new EntryGroup(this.ctx, this)
    const entry = this.ctx.fiber.entry
    if (entry) entry.subtree = this
  }

  get context(): Context {
    return this.ctx
  }

  /** Iterate entries in this tree and any nested subtrees. */
  * entries(): Generator<Entry, void, void> {
    for (const entry of Object.values(this.store)) {
      yield entry
      if (!entry.subtree) continue
      yield* entry.subtree.entries()
    }
  }

  /** Return pending import and lifecycle tasks owned by this tree. */
  getTasks() {
    return [...this.entries()]
      .map(entry => entry._initTask || entry.fiber?.inertia)
      .filter(isNonNullable)
  }

  /** Wait until this tree has no pending import or lifecycle tasks. */
  async await() {
    while (true) {
      const tasks = this.getTasks()
      if (!tasks.length) return
      await Promise.allSettled(tasks)
    }
  }

  ensureId(options: Partial<EntryOptions>) {
    if (!options.id) {
      do {
        options.id = Math.random().toString(16).slice(2, 10)
      } while (this.store[options.id])
    }
    return options.id!
  }

  /** Resolve an entry by id, including nested ids separated by `EntryTree.sep`. */
  resolve(id: string) {
    const parts = id.split(EntryTree.sep)
    let tree: EntryTree | undefined = this
    const final = parts.pop()!
    for (const part of parts) {
      tree = tree.store[part]?.subtree
      if (!tree) throw new Error(`cannot resolve entry ${id}`)
    }
    const entry = tree.store[final]
    if (!entry) throw new Error(`cannot resolve entry ${id}`)
    return entry
  }

  resolveGroup(id: string | null) {
    if (!id) return this.root
    const entry = this.resolve(id)
    if (!entry.subgroup) throw new Error(`entry ${id} is not a group`)
    return entry.subgroup
  }

  /** Create an entry in the root group or a nested group. */
  async create(options: Omit<EntryOptions, 'id'>, parent: string | null = null, position = Infinity) {
    const group = this.resolveGroup(parent)
    group.data.splice(position, 0, options as EntryOptions)
    group.tree.write()
    return group.create(options)
  }

  /** Stop and remove an entry from its parent group. */
  remove(id: string) {
    const entry = this.resolve(id)
    entry.parent.remove(id)
    entry.parent.tree.write()
  }

  /** Update an entry and optionally move it to another group. */
  async update(id: string, options: Omit<EntryOptions, 'id' | 'name'>, parent?: string | null, position?: number) {
    const entry = this.resolve(id)
    const source = entry.parent
    if (parent !== undefined) {
      const target = this.resolveGroup(parent)
      source.unlink(entry.options)
      target.data.splice(position ?? Infinity, 0, entry.options)
      target.tree.write()
      entry.parent = target
    }
    source.tree.write()
    return entry.update(options, false, true)
  }

  /** Import a plugin module from a specifier or `cordis:` builtin. */
  import(name: string, getOuterStack?: () => string[]) {
    if (name.startsWith('cordis:')) {
      return this.ctx.loader.builtins[name.slice(7)]
    }
    const specifier = rescopeSpecifier(name)
    return composeError(async (info) => {
      // ModuleJob.run
      // onImport.tracePromise.__proto__
      // internal.import
      info.offset += 3
      if (this.ctx.loader.internal) {
        return await this.ctx.loader.internal.import(specifier, this.ctx.baseUrl!, {})
      } else if (name.startsWith('.')) {
        return await import(/* @vite-ignore */new URL(specifier, this.ctx.baseUrl).href)
      } else {
        return await import(/* @vite-ignore */specifier)
      }
    }, getOuterStack)
  }

  /** Persist current tree state. In-memory trees may implement this as a no-op. */
  abstract write(): void
}
