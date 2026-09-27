/**
 * Expand the workspace path aliases that a wildcard would otherwise resolve by
 * probing every package group in turn.
 *
 * `tsconfig.base.json` is the resolution facade for the whole repository, and
 * two of its aliases used one key per *group* rather than per package:
 * `@mutantcat/dsh-*` listed 49 candidate globs and `@mutantcat/dsh-*\/invariant`
 * listed 45. TypeScript and tsx try those candidates in order, so a specifier
 * whose package sits late in the list pays for every earlier miss. Under tsx's
 * ESM hook each miss is an `ERR_MODULE_NOT_FOUND` that Node decorates with a
 * full CommonJS resolution walk, which dominated source-launch boot.
 *
 * This generator writes one explicit entry per package into a marked region of
 * `tsconfig.base.json`, leaving every hand-written alias and comment outside
 * that region untouched. `--check` reports drift instead of writing, so a new
 * package that needs an alias fails a gate rather than silently resolving
 * through a fallback that no longer exists.
 *
 * Every alias is emitted twice: once under the scope this repository owns and
 * once under the scope the harness published under before the rename. A plugin
 * published against the old scope still imports `@deepseek-ai/dsh-<name>`, and
 * both rows resolve to the same source, so such a plugin sees one module.
 *
 * @module scripts/gen-tsconfig-paths
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CONFIG = join(ROOT, 'tsconfig.base.json')
const BEGIN = '      // BEGIN generated package aliases — pnpm run gen-tsconfig-paths'
const END = '      // END generated package aliases'

/** Comment that separates the two scopes inside the generated region. */
const LEGACY_COMMENT = '      // Pre-rescope names, kept resolvable for plugins published against them.'

/** Scope this repository's packages moved away from; kept resolvable for plugins. */
const LEGACY_SCOPE = '@deepseek-ai'

/** Scope this repository's packages now live under. */
const SCOPE = '@mutantcat'

/** Package-name prefix the expanded aliases cover. */
const PREFIX = `${SCOPE}/dsh-`

/** One workspace package the generated region maps. */
interface PackageAlias {
  /** Bare specifier, e.g. `@mutantcat/dsh-session`. */
  readonly specifier: string
  /** Repository-relative source directory, e.g. `./packages/session/session/src`. */
  readonly source: string
  /** Whether the package carries `src/invariant.ts`, which earns a second alias. */
  readonly hasInvariant: boolean
}

/** An alias the config maps by hand, outside the generated region. */
interface HandWrittenAlias {
  /** Specifier as written in the config, e.g. `@mutantcat/cordis`. */
  readonly specifier: string
  /** Repository-relative source directory the alias points at. */
  readonly source: string
}

/**
 * Name a specifier under the scope the harness published under before the rename.
 * @param specifier - a `@mutantcat` bare specifier or subpath.
 * @returns The same package and subpath under the legacy scope.
 */
function legacySpecifier(specifier: string): string {
  return `${LEGACY_SCOPE}/${specifier.slice(SCOPE.length + 1)}`
}

/**
 * Read a workspace manifest's declared name.
 * @param manifest - absolute path to a `package.json`.
 * @returns The declared name, or undefined when the file is absent or nameless.
 */
function packageName(manifest: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifest, 'utf8'))
  } catch (_absentOrUnreadableManifest) {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const name: unknown = (parsed as { name?: unknown }).name
  return typeof name === 'string' ? name : undefined
}

/** One workspace package directory and the name its manifest declares. */
interface WorkspacePackage {
  readonly group: string
  readonly directory: string
  readonly packageDir: string
  readonly name: string
}

/**
 * Walk `packages/<group>/<directory>` once, in a stable order.
 * @returns Every directory whose manifest names a `@mutantcat/dsh-` package and that carries `src`.
 */
function workspacePackages(): WorkspacePackage[] {
  const packages = join(ROOT, 'packages')
  const found: WorkspacePackage[] = []
  for (const group of readdirSync(packages).sort()) {
    const groupDir = join(packages, group)
    if (!statSync(groupDir).isDirectory()) continue
    for (const directory of readdirSync(groupDir).sort()) {
      const packageDir = join(groupDir, directory)
      const name = packageName(join(packageDir, 'package.json'))
      if (name === undefined || !name.startsWith(PREFIX)) continue
      if (existsSync(join(packageDir, 'src'))) found.push({ group, directory, packageDir, name })
    }
  }
  return found
}

/**
 * Collect every package the removed wildcards could resolve.
 *
 * A wildcard substituted the specifier's suffix into `packages/<group>/<suffix>/src`,
 * so it only ever resolved a package whose declared name is exactly
 * `@mutantcat/dsh-<directory>`. Packages named after something other than
 * their directory already carry a hand-written alias and are skipped here.
 *
 * @returns Aliases sorted by specifier.
 * @throws When two package directories claim one specifier, which the removed
 * wildcards resolved by group order and an explicit map cannot express.
 */
export function collectPackageAliases(): PackageAlias[] {
  const bySpecifier = new Map<string, PackageAlias & { directory: string }>()
  for (const { group, directory, packageDir, name } of workspacePackages()) {
    if (name !== `${PREFIX}${directory}`) continue
    const previous = bySpecifier.get(name)
    if (previous !== undefined) {
      throw new Error(
        `gen-tsconfig-paths: ${name} is claimed by packages/${previous.directory} and packages/${group}/${directory}; `
        + 'an explicit alias cannot express the group-order tiebreak the wildcard used.',
      )
    }
    bySpecifier.set(name, {
      specifier: name,
      source: `./packages/${group}/${directory}/src`,
      hasInvariant: existsSync(join(packageDir, 'src', 'invariant.ts')),
      directory: `${group}/${directory}`,
    })
  }
  return [...bySpecifier.values()]
    .map(({ specifier, source, hasInvariant }) => ({ specifier, source, hasInvariant }))
    .sort((left, right) => left.specifier.localeCompare(right.specifier))
}

/**
 * Collect every workspace package the aliases must cover.
 *
 * Unlike {@link collectPackageAliases} this keeps packages whose name does not
 * match their directory. The generator cannot map those — only a hand-written
 * alias can — but they still have to be mapped by something, because deleting
 * the group wildcards removed the fallback that used to catch them.
 *
 * @returns Declared names of every `@mutantcat/dsh-` package carrying a `src` directory.
 */
export function collectPackageNames(): string[] {
  return workspacePackages()
    .map(({ name }) => name)
    .sort((left, right) => left.localeCompare(right))
}

/**
 * Read the aliases a config maps by hand, generated region excluded.
 * @param text - `tsconfig.base.json` contents.
 * @returns Every `@mutantcat` alias outside the region, in file order.
 * @throws When a key's value spans lines, which the single-line pattern cannot read.
 */
function handWrittenAliases(text: string): HandWrittenAlias[] {
  const begin = text.indexOf(BEGIN)
  const end = text.indexOf(END)
  const outside = begin < 0 || end < begin ? text : text.slice(0, begin) + text.slice(end)
  const keys: string[] = []
  for (const match of outside.matchAll(/^\s*"(@mutantcat\/[^"]+)":/gm)) {
    const key = match[1]
    if (key !== undefined) keys.push(key)
  }
  const aliases: HandWrittenAlias[] = []
  for (const match of outside.matchAll(/^\s*"(@mutantcat\/[^"]+)":\s*\["([^"]*)"\]/gm)) {
    const specifier = match[1]
    const source = match[2]
    if (specifier !== undefined && source !== undefined) aliases.push({ specifier, source })
  }
  if (aliases.length !== keys.length) {
    throw new Error(
      `gen-tsconfig-paths: ${String(keys.length - aliases.length)} hand-written alias(es) in ${CONFIG} `
      + 'do not fit the one-key-one-line-one-path pattern; render their legacy twin by hand.',
    )
  }
  return aliases
}

/**
 * Read the bare package specifiers a config maps, generated region included.
 * @param text - `tsconfig.base.json` contents.
 * @returns Specifiers mapped without a subpath.
 */
export function mappedSpecifiers(text: string): Set<string> {
  const keys = new Set<string>()
  for (const match of text.matchAll(/^\s*"(@mutantcat\/dsh-[^"/]+)":/gm)) {
    const key = match[1]
    if (key !== undefined) keys.add(key)
  }
  return keys
}

/**
 * Report packages that no alias maps.
 *
 * A package missing from `paths` still resolves — through the workspace symlink
 * and the package's own `exports` — but to built `lib/` output rather than to
 * source, which is the artifact-plane leak the explicit aliases exist to avoid.
 * Naming it here turns that into a gate failure instead of a silent difference.
 *
 * @param packages - every workspace package that needs an alias.
 * @param mapped - bare specifiers the config maps.
 * @returns Unmapped package names, in the order given.
 */
export function uncoveredPackages(
  packages: readonly string[],
  mapped: ReadonlySet<string>,
): string[] {
  return packages.filter(name => !mapped.has(name))
}

/**
 * Render the generated region's alias lines.
 * @param aliases - packages to map, in emission order.
 * @param handWritten - aliases already mapped outside the region; a duplicate key would shadow one silently.
 * @returns The region body, one JSON member per line, with a comment between the two scopes.
 */
export function renderAliases(aliases: readonly PackageAlias[], handWritten: readonly HandWrittenAlias[]): string {
  const mapped = new Set(handWritten.map(alias => alias.specifier))
  const current: string[] = []
  for (const alias of aliases) {
    if (!mapped.has(alias.specifier)) {
      current.push(`      ${JSON.stringify(alias.specifier)}: [${JSON.stringify(alias.source)}]`)
    }
    const invariant = `${alias.specifier}/invariant`
    if (alias.hasInvariant && !mapped.has(invariant)) {
      current.push(`      ${JSON.stringify(invariant)}: [${JSON.stringify(`${alias.source}/invariant.ts`)}]`)
    }
  }
  // A plugin published against the pre-rescope scope still imports that name, so
  // the region maps it to the same source. The vendored framework and every
  // package whose name does not match its directory arrive as hand-written
  // aliases, and their legacy twins come from the same rows.
  const legacy = new Map<string, string>()
  for (const alias of aliases) {
    legacy.set(legacySpecifier(alias.specifier), alias.source)
    if (alias.hasInvariant) {
      legacy.set(legacySpecifier(`${alias.specifier}/invariant`), `${alias.source}/invariant.ts`)
    }
  }
  for (const alias of handWritten) legacy.set(legacySpecifier(alias.specifier), alias.source)
  const previous = [...legacy]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([specifier, source]) => `      ${JSON.stringify(specifier)}: [${JSON.stringify(source)}]`)
  if (previous.length === 0) return current.join(',\n')
  if (current.length === 0) return [LEGACY_COMMENT, previous.join(',\n')].join('\n')
  // The region closes `paths`, so the last member carries no trailing comma. A
  // comment takes no comma, so the member before it carries one explicitly.
  return `${current.join(',\n')},\n${LEGACY_COMMENT}\n${previous.join(',\n')}`
}

/**
 * Replace the generated region of a config's text.
 * @param text - current `tsconfig.base.json` contents.
 * @param body - rendered alias lines.
 * @returns The updated contents.
 * @throws When the markers are missing or out of order.
 */
export function writeRegion(text: string, body: string): string {
  const begin = text.indexOf(BEGIN)
  const end = text.indexOf(END)
  if (begin < 0 || end < begin) {
    throw new Error(`gen-tsconfig-paths: ${CONFIG} is missing the generated-region markers.`)
  }
  return `${text.slice(0, begin)}${BEGIN}\n${body}\n${END}${text.slice(end + END.length)}`
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const check = process.argv.includes('--check')
  const current = readFileSync(CONFIG, 'utf8')
  const handWritten = handWrittenAliases(current)
  const next = writeRegion(current, renderAliases(collectPackageAliases(), handWritten))
  const uncovered = uncoveredPackages(collectPackageNames(), mappedSpecifiers(next))
  if (uncovered.length > 0) {
    console.error(
      'gen-tsconfig-paths: no alias maps '
      + `${uncovered.join(', ')}; add a hand-written entry, because a package named after `
      + 'something other than its directory cannot be generated.',
    )
    process.exitCode = 1
  } else if (current === next) {
    console.log('gen-tsconfig-paths: tsconfig.base.json package aliases are current.')
  } else if (check) {
    console.error('gen-tsconfig-paths: tsconfig.base.json is stale; run `pnpm run gen-tsconfig-paths`.')
    process.exitCode = 1
  } else {
    writeFileSync(CONFIG, next)
    console.log('gen-tsconfig-paths: rewrote tsconfig.base.json package aliases.')
  }
}
