/** Prepare the target Node runtime and pinned pnpm CLI. */

import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { readPrimaryRuntime } from '../../desktop-host/src/primary-runtime.ts'
import { resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { preparePrimaryRuntime } from './prepare-primary-runtime.ts'

const BUILD_PATHS = resolveDesktopTargetBuildPaths()
const RUNTIME_ROOT = BUILD_PATHS.runtime

function preparePnpm(): string {
  const require = createRequire(import.meta.url)
  const manifestPath = require.resolve('pnpm')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string') throw new Error('desktop runtime: pnpm manifest has no version')
  const packageDir = dirname(manifestPath)
  const destination = join(RUNTIME_ROOT, 'pnpm')
  rmSync(destination, { recursive: true, force: true })
  cpSync(packageDir, destination, { recursive: true })
  return manifest.version
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'defer-primary-runtime-smoke': { type: 'boolean', default: false } } })
  rmSync(RUNTIME_ROOT, { recursive: true, force: true })
  mkdirSync(RUNTIME_ROOT, { recursive: true })
  const pnpmVersion = preparePnpm()
  cpSync(join(import.meta.dirname, 'node-bin'), join(RUNTIME_ROOT, 'bin'), { recursive: true })
  chmodSync(join(RUNTIME_ROOT, 'bin', 'node'), 0o755)
  await preparePrimaryRuntime({ deferSmoke: values['defer-primary-runtime-smoke'] })
  const runtime = await readPrimaryRuntime(join(RUNTIME_ROOT, 'primary-runtime'))
  writeFileSync(join(RUNTIME_ROOT, 'versions.json'), `${JSON.stringify({
    schemaVersion: 1,
    node: runtime.components.node,
    pnpm: pnpmVersion,
  }, undefined, 2)}\n`)
}

await main()
