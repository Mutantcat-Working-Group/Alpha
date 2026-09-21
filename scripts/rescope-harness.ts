/**
 * Move every repository-owned package from the `@deepseek-ai` scope to the
 * `@mutantcat` scope, and undo that move with `--reverse`.
 *
 * The rule is a single token substitution: `@deepseek-ai` becomes `@mutantcat`
 * wherever the token is a package scope. The scope is always written as a
 * delimited token — quoted, after `/`, after a backslash inside a regex
 * literal, or before `:` in an `.npmrc` key — so one substitution covers every
 * spelling the repository uses: `'@deepseek-ai/dsh-session'`,
 * `node_modules/@deepseek-ai/dsh`, `` `@deepseek-ai\/dsh-[^"]+` ``,
 * `@deepseek-ai:registry=`, `'@deepseek-ai', 'dsh'`, and the bare mentions in
 * comments and Markdown.
 *
 * Two classes of occurrence are deliberately left alone.
 *
 * `@deepseek-ai/libreoffice-kit` and its platform packages are an external
 * registry dependency, not a repository package. The forward lookahead keeps
 * every `libreoffice-kit*` name on its registry scope, which leaves
 * `minimumReleaseAgeExclude`, `EXTERNAL_KIT_PACKAGES`, and the office-engine
 * staging paths untouched.
 *
 * Six sites spell the scope as a standalone path segment whose sibling names
 * the external engine rather than a repository package, so a lookahead cannot
 * see the engine from the scope token. {@link EXTERNAL_ENGINE_LINES} lists them
 * by file and line, and each is asserted to still carry the legacy scope after
 * the run so a moved or deleted site fails loudly instead of being renamed.
 *
 * The legacy-scope half of the generated alias region in `tsconfig.base.json`
 * names the old scope on purpose. It is skipped line by line, and `--reverse`
 * drops the half outright, because rewriting it would collapse both halves of
 * the region onto one scope.
 *
 * Compatibility for code that still names the old scope lives outside this
 * codemod: `scripts/gen-tsconfig-paths.ts` emits a legacy-scope alias beside
 * every generated one so source importing `@deepseek-ai/dsh-*` resolves to the
 * same sources, the vendored Loader rewrites a legacy plugin specifier to its
 * current name before importing it, and
 * [docs/harness-scope.md](../docs/harness-scope.md) records the mapping.
 *
 * Usage: `pnpm run rescope-harness [--apply|--check] [--reverse]`. Without a
 * mode it reports what would change. `--check` asserts the post-state: no
 * residue outside the guarded lines, every guard still holds, and a second
 * `--apply` would be a no-op.
 *
 * @module scripts/rescope-harness
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(import.meta.dirname, '..')

/** The scope every repository-owned package leaves. */
const LEGACY_SCOPE = '@deepseek-ai'

/** The scope every repository-owned package joins. */
const SCOPE = '@mutantcat'

/**
 * The external engine package family that keeps its registry scope.
 *
 * `@deepseek-ai/libreoffice-kit` is consumed from npm and never published
 * here, and its platform packages (`-wasm`, `-darwin-arm64`, ...) share the
 * prefix. No repository package starts with it: the Office package is
 * `@deepseek-ai/dsh-office-to-pdf`, which the lookahead does not match.
 */
const EXTERNAL_ENGINE = 'libreoffice-kit'

/** File extensions that carry a scope token; every other extension has none. */
const EXTENSIONS = [
  '.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.c',
  '.json', '.jsonl', '.yml', '.yaml', '.md', '.snap',
  '.py', '.tpl',
] as const

/** A line the codemod must leave alone, asserted before and after the run. */
interface GuardedLine {
  readonly file: string
  /** One-based line number, asserted before the run so a moved site fails. */
  readonly line: number
  readonly reason: string
}

/**
 * Sites the lookahead cannot protect.
 *
 * Each spells the scope alone and names the engine in a following segment, a
 * later argument, or a later line, so the engine is invisible from the scope
 * token. Every one is a staging or fixture path for the engine's own files.
 */
const EXTERNAL_ENGINE_LINES: readonly GuardedLine[] = [
  { file: 'apps/desktop/scripts/prepare-dsh.ts', line: 161, reason: 'stages the engine prebuilds.json beside the runtime' },
  { file: 'python/sdk/tests/test_release_version.py', line: 124, reason: 'reads an engine asset from the packed office tree' },
  { file: 'python/sdk/tests/test_runtime_resolution.py', line: 259, reason: 'selects a foreign engine platform directory' },
  { file: 'scripts/build-exe-for-python-sdk-office.ts', line: 38, reason: 'stages the engine package into the EXE payload' },
  { file: 'scripts/build-python-release.py', line: 238, reason: 'the directory holding only engine platform packages' },
  { file: 'scripts/smoke-python-runtime.py', line: 815, reason: 'globs the engine prebuilds.json manifests' },
]

/**
 * Lines whose whole job is to name the legacy scope.
 *
 * Each is a constant the compatibility path reads, so the substitution would
 * otherwise rename the very thing that performs the rename.
 */
const LEGACY_COMPAT_LINES: readonly GuardedLine[] = [
  { file: 'scripts/gen-tsconfig-paths.ts', line: 40, reason: 'declares the scope the alias generator emits a twin for' },
  { file: 'scripts/gen-tsconfig-paths.ts', line: 21, reason: 'documents the imports a legacy-scope plugin still uses' },
  { file: 'vendor/loader/src/config/tree.ts', line: 7, reason: 'declares the scope the Loader rewrites a plugin specifier from' },
  { file: 'vendor/loader/src/config/tree.ts', line: 19, reason: 'documents the specifier spelling the Loader rewrites' },
  { file: 'scripts/gen-tsconfig-paths.spec.ts', line: 48, reason: 'asserts the legacy twin a hand-written alias earns' },
  { file: 'scripts/gen-tsconfig-paths.spec.ts', line: 49, reason: 'asserts the legacy twin beside a hand-written invariant alias' },
  { file: 'scripts/gen-tsconfig-paths.spec.ts', line: 50, reason: 'asserts the legacy twin a generated alias earns' },
]

/** Every line the substitution skips. */
const GUARDED_LINES: readonly GuardedLine[] = [...EXTERNAL_ENGINE_LINES, ...LEGACY_COMPAT_LINES]

/** Line that opens the legacy-scope half of the generated alias region. */
const LEGACY_REGION_BEGIN = '      // Pre-rescope names, kept resolvable for plugins published against them.'

/** Line that closes the generated alias region in `tsconfig.base.json`. */
const LEGACY_REGION_END = '      // END generated package aliases'

/** A string that must appear exactly `count` times once the rescope has run. */
interface PostCondition {
  readonly file: string
  readonly text: string
  readonly count: number
}

const POSTCONDITIONS: readonly PostCondition[] = [
  // The root workspace identity and the vendored framework both move.
  { file: 'package.json', text: '"name": "@mutantcat/dsh-root"', count: 1 },
  { file: 'vendor/cordis/package.json', text: '"name": "@mutantcat/cordis"', count: 1 },
  { file: 'vendor/loader/package.json', text: '"name": "@mutantcat/cordis-plugin-loader"', count: 1 },
  // The rescope that maintains the vendored set now targets the new scope.
  { file: 'scripts/rescope-vendor.ts', text: "'@deepseek-ai/cordis'", count: 0 },
  { file: 'scripts/rescope-vendor.ts', text: "upstream: 'cordis', scoped: '@mutantcat/cordis'", count: 1 },
  // The external engine family keeps its registry scope everywhere.
  { file: 'pnpm-workspace.yaml', text: "'@deepseek-ai/libreoffice-kit@0.0.1'", count: 1 },
  { file: 'pnpm-workspace.yaml', text: "'@deepseek-ai/libreoffice-kit-wasm@0.0.1'", count: 1 },
  { file: 'scripts/verify-default-product-isolation.ts', text: "EXTERNAL_KIT_PACKAGES = new Set(['@deepseek-ai/libreoffice-kit'])", count: 1 },
  // The registry key the catalog generators write.
  { file: 'scripts/gen-dependency-catalog.ts', text: '@mutantcat:registry=', count: 1 },
  // The generator that owns the source-plane aliases.
  { file: 'scripts/gen-tsconfig-paths.ts', text: "const SCOPE = '@mutantcat'", count: 1 },
  { file: 'scripts/gen-tsconfig-paths.ts', text: "const LEGACY_SCOPE = '@deepseek-ai'", count: 1 },
  { file: 'scripts/gen-tsconfig-paths.ts', text: '@mutantcat\\/dsh-[^"/]+', count: 1 },
  // The legacy half of the generated alias region, and one row that proves it
  // maps the vendored framework rather than a stale copy of the current scope.
  { file: 'tsconfig.base.json', text: LEGACY_REGION_BEGIN, count: 1 },
  { file: 'tsconfig.base.json', text: '"@deepseek-ai/cordis": ["./vendor/cordis/src"]', count: 1 },
  // The Loader's plugin-specifier rewrite.
  { file: 'vendor/loader/src/config/tree.ts', text: "const LEGACY_SCOPE = '@deepseek-ai/'", count: 1 },
]

/** Tracked files this codemod never reads. */
function isRescopeExcluded(file: string): boolean {
  if (file === 'scripts/rescope-harness.ts') return true
  // The codemod's own tests name both scopes on purpose as test data, and the
  // assertions pin the legacy scope the way a guarded line would.
  if (file === 'scripts/rescope-harness.spec.ts') return true
  // The lockfile belongs to the package manager; `pnpm install` rewrites it.
  if (file === 'pnpm-lock.yaml') return true
  // These two files document the legacy scope on purpose and are edited by hand.
  if (file === 'docs/harness-scope.md' || file === 'docs/harness-scope.zh.md') return true
  // Agent notes record what was true when they were written.
  if (file.startsWith('.agents/notes/')) return true
  // Upstream vendored files keep their upstream text.
  if (/^vendor\/[^/]+\/(README\.md|LICENSE)$/.test(file)) return true
  return !EXTENSIONS.some(extension => file.endsWith(extension))
}

/** Escape a literal for use inside a regular expression. */
function escapeLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Match the scope the current direction leaves from.
 *
 * Forward removes the legacy scope token wherever it is not the external
 * engine's scope; reverse removes the current scope token, which has no
 * external-engine exception.
 * @param reverse - whether the codemod moves back to the legacy scope.
 * @returns A fresh global regular expression.
 */
function scopePattern(reverse: boolean): RegExp {
  if (reverse) return new RegExp(escapeLiteral(SCOPE), 'g')
  return new RegExp(`${escapeLiteral(LEGACY_SCOPE)}(?!\\/${escapeLiteral(EXTERNAL_ENGINE)})`, 'g')
}

/**
 * Rewrite one line, honouring the external-engine guards.
 * @param line - the line's text.
 * @param file - repository-relative path, used to match a guard.
 * @param lineNumber - one-based line number.
 * @param reverse - whether to move back to the legacy scope.
 * @returns The rewritten line and how many scope tokens it replaced.
 */
export function rewriteLine(line: string, file: string, lineNumber: number, reverse: boolean): { text: string; replaced: number } {
  if (GUARDED_LINES.some(guard => guard.file === file && guard.line === lineNumber)) {
    return { text: line, replaced: 0 }
  }
  const to = reverse ? LEGACY_SCOPE : SCOPE
  let replaced = 0
  const text = line.replace(scopePattern(reverse), () => {
    replaced += 1
    return to
  })
  return { text, replaced }
}

/**
 * Find legacy-scope tokens a file still carries outside the guarded lines and
 * the generated alias region.
 *
 * The guarded lines and the legacy half of the generated region name the old
 * scope on purpose, so a check that counts every occurrence would report the
 * very sites the mapping must keep. The residue scan is what remains.
 * @param file - repository-relative path, used to match a guard.
 * @param content - file text, defaulting to the file on disk.
 * @returns Every one-based line carrying a legacy token outside the guards and region.
 */
export function legacyResidue(file: string, content = readFileSync(resolve(root, file), 'utf8')): { line: number; text: string }[] {
  const hits: { line: number; text: string }[] = []
  let inLegacyRegion = false
  const lines = content.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line === LEGACY_REGION_BEGIN) {
      inLegacyRegion = true
    } else if (line === LEGACY_REGION_END) {
      inLegacyRegion = false
    } else if (!inLegacyRegion && !GUARDED_LINES.some(guard => guard.file === file && guard.line === index + 1)) {
      if (line.match(scopePattern(false)) !== null) hits.push({ line: index + 1, text: line })
    }
  }
  return hits
}

/**
 * How one file groups in the dry-run report.
 * @param file - repository-relative path.
 * @returns A human-readable category.
 */
function classify(file: string): string {
  if (/(^|\/)package\.json$/.test(file)) return 'package manifests'
  if (/\.(ts|tsx|mts)$/.test(file)) return 'TypeScript sources and tests'
  if (/\.(js|mjs|cjs)$/.test(file)) return 'JavaScript sources and scripts'
  if (/\.py$/.test(file)) return 'Python SDK sources and tests'
  if (/\.(yml|yaml)$/.test(file)) return 'workflow and workspace YAML'
  if (file.endsWith('.jsonl')) return 'recorded session fixtures'
  if (file.endsWith('.json')) return 'generated catalogs and configuration'
  if (file.endsWith('.md')) return 'documentation'
  return 'other'
}

function main(): void {
  const args = process.argv.slice(2)
  const mode = args.includes('--apply') ? 'apply' : args.includes('--check') ? 'check' : 'dry'
  const reverse = args.includes('--reverse')

  const failures: string[] = []
  // Every guard must still point at a line carrying the legacy scope, or the
  // site moved and the codemod would silently stop protecting it.
  for (const guard of GUARDED_LINES) {
    const path = resolve(root, guard.file)
    let text: string
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      failures.push(`guarded line ${guard.file}:${String(guard.line)}: file is unreadable`)
      continue
    }
    if (!(text.split('\n')[guard.line - 1] ?? '').includes(LEGACY_SCOPE)) {
      failures.push(`guarded line ${guard.file}:${String(guard.line)}: no longer carries the legacy scope (${guard.reason})`)
    }
  }
  if (failures.length > 0) {
    for (const failure of failures) console.error(`rescope-harness: ${failure}`)
    console.error(`rescope-harness: ${String(failures.length)} problem(s); nothing was written.`)
    process.exitCode = 1
    return
  }

  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(file => file !== '' && !isRescopeExcluded(file))

  const counts = new Map<string, { files: number; scopes: number }>()
  const changed: string[] = []
  for (const file of files) {
    const path = resolve(root, file)
    let before: string
    try {
      if (!statSync(path).isFile()) continue
      before = readFileSync(path, 'utf8')
    } catch {
      failures.push(`${file}: unreadable; the token survey assumed every tracked file is UTF-8 text`)
      continue
    }
    let scopes = 0
    let inLegacyRegion = false
    let after = before
      .split('\n')
      .map((line, index) => {
        if (line === LEGACY_REGION_BEGIN) inLegacyRegion = true
        else if (line === LEGACY_REGION_END) inLegacyRegion = false
        // The legacy half of the generated alias region names the old scope on
        // purpose; rewriting it would collapse both halves onto one scope.
        else if (inLegacyRegion) return line
        const rewritten = rewriteLine(line, file, index + 1, reverse)
        scopes += rewritten.replaced
        return rewritten.text
      })
      .join('\n')
    if (reverse) {
      // Both halves would then carry the same scope, so the legacy half is
      // dropped rather than rewritten, and the member before it loses its comma.
      const opened = after.indexOf(`\n${LEGACY_REGION_BEGIN}\n`)
      const closed = after.indexOf(`\n${LEGACY_REGION_END}\n`)
      if (opened >= 0 && closed > opened) {
        after = `${after.slice(0, opened).replace(/,$/, '')}\n${after.slice(closed + 1)}`
      }
    }
    if (after === before) continue
    changed.push(file)
    const kind = classify(file)
    const current = counts.get(kind) ?? { files: 0, scopes: 0 }
    counts.set(kind, { files: current.files + 1, scopes: current.scopes + scopes })
    if (mode === 'apply') writeFileSync(path, after)
  }

  console.log(`rescope-harness: ${mode}${reverse ? ' --reverse' : ''} over ${String(files.length)} tracked files`)
  for (const kind of [...counts.keys()].sort()) {
    const { files: fileCount, scopes } = counts.get(kind) ?? { files: 0, scopes: 0 }
    console.log(`  ${kind.padEnd(30)} ${String(fileCount).padStart(4)} file(s), ${String(scopes).padStart(5)} scope(s)`)
  }

  if (mode === 'check') {
    for (const guard of GUARDED_LINES) {
      const path = resolve(root, guard.file)
      const line = readFileSync(path, 'utf8').split('\n')[guard.line - 1] ?? ''
      if (!line.includes(LEGACY_SCOPE)) {
        failures.push(`external engine guard ${guard.file}:${String(guard.line)} lost the legacy scope`)
      }
    }
    for (const check of POSTCONDITIONS) {
      const path = resolve(root, check.file)
      const hits = readFileSync(path, 'utf8').split(check.text).length - 1
      if (hits !== check.count) {
        failures.push(`postcondition: ${check.file} has ${String(hits)} occurrence(s) of ${JSON.stringify(check.text)}, expected ${String(check.count)}`)
      }
    }
    for (const file of changed) {
      for (const hit of legacyResidue(file)) {
        failures.push(`residue: ${file}:${String(hit.line)} still carries a pre-rescope scope token`)
      }
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`rescope-harness: ${failure}`)
    console.error(`rescope-harness: ${String(failures.length)} problem(s); the mapping or a site moved.`)
    process.exitCode = 1
  } else if (mode === 'check') {
    console.log('rescope-harness: post-state verified — no residue, every guard holds, idempotent.')
  } else if (mode === 'apply') {
    console.log('rescope-harness: applied. Run `pnpm install`, then `pnpm run gen-tsconfig-paths` and the catalog generators.')
  }
}

// Importing this module for its exported classifier must not run the codemod.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main()
}
