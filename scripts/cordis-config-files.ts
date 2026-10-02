/** Cordis Loader configuration file discovery. */

import { execFileSync } from 'node:child_process'
import {
  globSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
} from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

/** One discovered Loader configuration, with any git symlink resolved. */
export interface CordisConfigDocument {
  file: string
  text: string
}

/** Discovery inputs that need to be supplied outside a git checkout. */
export interface CordisConfigDiscoveryOptions {
  symlinkPaths?: ReadonlySet<string>
}

/**
 * Return repository-relative Cordis Loader YAML paths under `root`.
 *
 * Translation consistency records are YAML sidecars, never Loader inputs.
 *
 * @param root Repository root to scan.
 * @returns Sorted repository-relative Loader configuration paths.
 */
export function cordisConfigFiles(root: string): string[] {
  return globSync(['**/*cordis*.yml', '**/*cordis*.yaml'], {
    cwd: root,
    exclude: ['.claude/**', 'node_modules/**', 'vendor/**', '**/*.i18n.yaml'],
  }).sort()
}

/**
 * Read every Loader configuration, following both filesystem symlinks and
 * symlinks recorded by git when the checkout materialized them as regular
 * files. A logical path that resolves to an already-read target is skipped, so
 * the first sorted path remains the one used for package-resolution checks.
 *
 * @param root Repository root to scan.
 * @param options Optional discovery inputs for callers without a git checkout.
 * @returns Sorted Loader configurations with their resolved source text.
 */
export function cordisConfigDocuments(
  root: string,
  options: CordisConfigDiscoveryOptions = {},
): CordisConfigDocument[] {
  const symlinkPaths = options.symlinkPaths ?? gitSymlinkPaths(root)
  const documents: CordisConfigDocument[] = []
  const seenTargets = new Set<string>()

  for (const file of cordisConfigFiles(root)) {
    const absolutePath = resolve(root, file)
    const isGitSymlink = symlinkPaths.has(file) || symlinkPaths.has(file.replaceAll('\\', '/'))
    const targetPath = lstatSync(absolutePath).isSymbolicLink()
      ? resolveFilesystemSymlinkTarget(root, file, absolutePath)
      : isGitSymlink
        ? resolveMaterializedSymlinkTarget(root, file, absolutePath)
        : absolutePath
    const canonicalTarget = realpathSync(targetPath)
    if (seenTargets.has(canonicalTarget)) continue
    seenTargets.add(canonicalTarget)
    documents.push({ file, text: readFileSync(canonicalTarget, 'utf8') })
  }
  return documents
}

/** Repository-relative paths recorded by git with symlink mode. */
function gitSymlinkPaths(root: string): ReadonlySet<string> {
  const records = execFileSync('git', ['ls-files', '-s', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).split('\0')
  const paths = new Set<string>()
  for (const record of records) {
    const separator = record.indexOf('\t')
    if (separator === -1 || !record.startsWith('120000 ')) continue
    paths.add(record.slice(separator + 1))
  }
  return paths
}

/** Resolve one filesystem symlink target relative to its logical repository path. */
function resolveFilesystemSymlinkTarget(root: string, file: string, absolutePath: string): string {
  const target = readlinkSync(absolutePath)
  return isAbsolute(target) ? target : resolve(root, dirname(file), target)
}

/** Resolve one git symlink materialized as a regular file by the checkout. */
function resolveMaterializedSymlinkTarget(root: string, file: string, absolutePath: string): string {
  const target = readFileSync(absolutePath, 'utf8').trimEnd()
  return isAbsolute(target) ? target : resolve(root, dirname(file), target)
}
