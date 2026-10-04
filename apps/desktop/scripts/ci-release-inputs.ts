/** Source-level inputs every release artifact builds from, independent of the shell technology. */

import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { desktopTargetBuildPaths } from './desktop-build-paths.mjs'
import type { CiPackageTarget } from './ci-package.ts'
import { pnpmInvocation } from '../../../scripts/pnpm-invocation.ts'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')

/**
 * Environment that pins one packaging run to a single Desktop target.
 * @param target - Validated release target.
 * @returns The process environment carrying the target platform and architecture.
 */
export function releaseTargetEnv(target: CiPackageTarget): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DSH_DESKTOP_TARGET_PLATFORM: target.platform,
    DSH_DESKTOP_TARGET_ARCH: target.arch,
  }
}

/**
 * Run one pnpm command and inherit its output.
 * @param args - Arguments passed to the pnpm CLI.
 * @param cwd - Working directory for the command.
 * @param env - Environment for the command.
 * @returns Resolves when the command exits successfully.
 */
export function runPnpm(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  const invocation = pnpmInvocation(args, env)
  return new Promise((resolvePromise, reject) => {
    const child = spawn(invocation.command, invocation.args, { cwd, env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`ci package: pnpm ${args.join(' ')} exited with ${String(code ?? signal)}`))
    })
  })
}

/**
 * Run one npm command and inherit its output.
 * Platform packages are packed with npm because `pnpm pack` normalizes file
 * modes and strips the Landlock launcher's executable bit.
 * @param args - Arguments passed to the npm CLI.
 * @param cwd - Working directory for the command.
 * @param env - Environment for the command.
 * @returns Resolves when the command exits successfully.
 */
export function runNpm(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('npm', args, { cwd, env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`ci package: npm ${args.join(' ')} exited with ${String(code ?? signal)}`))
    })
  })
}

/**
 * Native platform package that supplies one release target's prebuilt system binaries.
 * Windows has no native package: flock is unsupported there and Landlock is Linux-only.
 * @param target - Validated release target.
 * @returns Repository-relative package directory, or undefined when the target ships no native package.
 */
export function nativePlatformPackageDir(target: CiPackageTarget): string | undefined {
  if (target.platform === 'darwin' || target.platform === 'linux') {
    return `native/system/packages/${target.platform}-${target.arch}`
  }
  return undefined
}

/**
 * Build the monorepo and stage the packed dsh runtime every shell technology bundles.
 * @param target - Validated release target.
 * @returns Resolves after the target's runtime and package set are prepared.
 */
export async function prepareReleaseInputs(target: CiPackageTarget): Promise<void> {
  const buildPaths = desktopTargetBuildPaths(target.name)
  const buildEnv: NodeJS.ProcessEnv = { ...process.env }
  await runPnpm(['run', 'build:official'], REPOSITORY_ROOT, buildEnv)
  await runPnpm(['run', 'release:pack', '--family', 'alpha', '--out', buildPaths.packedDsh], REPOSITORY_ROOT, buildEnv)
  await runPnpm(['--dir', 'apps/desktop-host', 'pack', '--pack-destination', buildPaths.packedDsh], REPOSITORY_ROOT, buildEnv)
  await runPnpm(['run', 'release:pack', '--family', 'vendor', '--out', buildPaths.packedVendor], REPOSITORY_ROOT, buildEnv)
  rmSync(buildPaths.packedLandlock, { recursive: true, force: true })
  mkdirSync(buildPaths.packedLandlock, { recursive: true })
  await runPnpm(['--dir', 'native/system', 'run', 'build:ts'], REPOSITORY_ROOT, buildEnv)
  // The entry resolves its platform package at runtime, so a release that omits
  // the matching tarball ships an addon that fails on first lock acquisition.
  const platformPackage = nativePlatformPackageDir(target)
  if (platformPackage !== undefined) {
    await runPnpm(['--dir', 'native/system', 'run', 'build:native'], REPOSITORY_ROOT, buildEnv)
    await runNpm(['pack', platformPackage, '--pack-destination', buildPaths.packedLandlock], REPOSITORY_ROOT, buildEnv)
  }
  await runPnpm([
    '--dir', 'native/system/packages/entry', 'pack', '--pack-destination', buildPaths.packedLandlock,
  ], REPOSITORY_ROOT, buildEnv)
  await runPnpm(['run', 'prepare:runtime'], APP_ROOT, releaseTargetEnv(target))
  await runPnpm(['run', 'prepare:packages'], APP_ROOT, releaseTargetEnv(target))
  // Ad-hoc signing happens inside the bundle, so the runtime tree stays unsigned here.
  await runPnpm(['run', 'prepare:dsh', '--ad-hoc'], APP_ROOT, releaseTargetEnv(target))
}
