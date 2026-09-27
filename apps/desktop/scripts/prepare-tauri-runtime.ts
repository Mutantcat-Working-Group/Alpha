/** Stage the prepared dsh runtime and its Node sidecar into the Tauri shell bundles. */

import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readPrimaryRuntime, workspaceDependencyPaths } from '../../desktop-host/src/primary-runtime.ts'
import { desktopTargetBuildPaths, resolveDesktopBuildTarget, type DesktopBuildTarget } from './desktop-build-paths.mjs'
import { tauriTargetTriple } from './tauri-targets.ts'

const APP_ROOT = resolve(import.meta.dirname, '..')
const SRC_TAURI = join(APP_ROOT, 'src-tauri')
const STAGING_RUNTIME = join(SRC_TAURI, 'staging', 'runtime')
const SIDECAR_DIRECTORY = join(SRC_TAURI, 'bin')

/** Prepared payload entries the bundled engine reads at runtime. */
const RUNTIME_ENTRIES = [
  { name: 'node_modules', source: 'dsh' },
  { name: 'package.json', source: 'dsh' },
  { name: 'pnpm', source: 'runtime' },
  { name: 'primary-runtime', source: 'runtime' },
  { name: 'office-skills', source: 'runtime' },
  { name: 'versions.json', source: 'runtime' },
] as const

/**
 * Require a prepared input before staging reads it.
 * @param path - Absolute path a prepare step owns.
 * @param preparation - Prepare command that produces the path.
 * @returns Nothing; throws when the prepare step has not run.
 */
function requirePrepared(path: string, preparation: string): void {
  if (!existsSync(path)) throw new Error(`tauri runtime: missing ${path}; run ${preparation} first`)
}

/**
 * Copy a prepared tree, replacing any previous staging content.
 * @param source - Prepared source path.
 * @param destination - Staging destination path.
 * @returns Nothing.
 */
function replaceTree(source: string, destination: string): void {
  rmSync(destination, { recursive: true, force: true })
  cpSync(source, destination, { recursive: true, dereference: true })
}

/**
 * Reject a sidecar whose Node ABI differs from the interpreter that installed the runtime.
 * @param target - Selected Desktop target.
 * @param runtime - Prepared runtime directory holding `versions.json`.
 * @param bundledNode - Node version carried by the primary runtime payload.
 * @returns Nothing; throws when the Node major versions disagree.
 */
function assertNodeAbi(target: DesktopBuildTarget, runtime: string, bundledNode: string): void {
  const versions = JSON.parse(readFileSync(join(runtime, 'versions.json'), 'utf8')) as { node?: unknown }
  if (typeof versions.node !== 'string') throw new Error('tauri runtime: versions.json has no bundled Node version')
  const installed = Number.parseInt(versions.node.split('.')[0] ?? '', 10)
  const bundled = Number.parseInt(bundledNode.split('.')[0] ?? '', 10)
  if (Number.isNaN(installed) || Number.isNaN(bundled) || installed !== bundled) {
    throw new Error(`tauri runtime: ${target} installs native modules with Node ${versions.node} but ships Node ${bundledNode}`)
  }
}

/**
 * Stage the runtime payload and the per-target Node sidecar for `tauri build`.
 * @param target - Selected Desktop target; defaults to the build host's target.
 * @returns Resolves after both staging directories hold the prepared payload.
 */
export async function prepareTauriRuntime(target: DesktopBuildTarget = resolveDesktopBuildTarget()): Promise<void> {
  const paths = desktopTargetBuildPaths(target)
  const triple = tauriTargetTriple(target)
  const primaryRuntime = join(paths.runtime, 'primary-runtime')
  requirePrepared(join(paths.dsh, 'node_modules'), 'prepare:dsh')
  requirePrepared(join(paths.dsh, 'package.json'), 'prepare:dsh')
  requirePrepared(primaryRuntime, 'prepare:primary-runtime')
  requirePrepared(join(paths.runtime, 'office-skills'), 'prepare:primary-runtime')
  const manifest = await readPrimaryRuntime(primaryRuntime)
  const node = workspaceDependencyPaths(primaryRuntime, manifest).node
  if (!existsSync(node)) throw new Error(`tauri runtime: missing sidecar source ${node}; run prepare:primary-runtime first`)
  assertNodeAbi(target, paths.runtime, manifest.components.node)

  mkdirSync(STAGING_RUNTIME, { recursive: true })
  const staged = new Set(readdirSync(STAGING_RUNTIME))
  for (const entry of RUNTIME_ENTRIES) {
    const source = entry.source === 'dsh' ? join(paths.dsh, entry.name) : join(paths.runtime, entry.name)
    requirePrepared(source, entry.source === 'dsh' ? 'prepare:dsh' : 'prepare:runtime')
    replaceTree(source, join(STAGING_RUNTIME, entry.name))
    staged.delete(entry.name)
  }
  // A payload staged for another target would survive a bundle and confuse the shell.
  for (const leftover of staged) rmSync(join(STAGING_RUNTIME, leftover), { recursive: true, force: true })
  replaceTree(node, join(STAGING_RUNTIME, 'bin', 'node'))
  chmodSync(join(STAGING_RUNTIME, 'bin', 'node'), 0o755)

  // One sidecar per bundle: a stale binary from another target would ship with the wrong ABI.
  mkdirSync(SIDECAR_DIRECTORY, { recursive: true })
  for (const existing of readdirSync(SIDECAR_DIRECTORY)) {
    rmSync(join(SIDECAR_DIRECTORY, existing), { recursive: true, force: true })
  }
  const windows = target === 'win-x64'
  const sidecar = join(SIDECAR_DIRECTORY, `node-${triple}${windows ? '.exe' : ''}`)
  cpSync(node, sidecar)
  if (!windows) chmodSync(sidecar, 0o755)
  process.stdout.write(`tauri runtime: staged ${STAGING_RUNTIME} and ${sidecar}\n`)
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  await prepareTauriRuntime()
}
