/** Build one ad-hoc release artifact for a GitHub release, without certificates or an update feed. */

import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { join, resolve } from 'node:path'
import { desktopTargetBuildPaths, type DesktopBuildTarget } from './desktop-build-paths.mjs'
import { pnpmInvocation } from '../../../scripts/pnpm-invocation.ts'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')

/** One release artifact and the electron-builder selectors that produce it. */
interface CiPackageTarget {
  readonly name: DesktopBuildTarget
  readonly platform: 'darwin' | 'win32' | 'linux'
  readonly arch: 'arm64' | 'x64'
  readonly builderPlatform: '--mac' | '--win' | '--linux'
  readonly builderArch: '--arm64' | '--x64'
  /** Filename suffixes the upload step collects from the artifact directory. */
  readonly artifactExtensions: readonly string[]
}

/**
 * Map a Node.js platform to the target-name prefix used by the packaging scripts.
 * @param platform - Build-host Node.js platform.
 * @returns The `mac`, `win`, or `linux` prefix.
 */
function targetOsPrefix(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'mac'
  return platform === 'win32' ? 'win' : 'linux'
}

const TARGETS: Record<string, CiPackageTarget> = {
  'mac-arm64': {
    name: 'mac-arm64', platform: 'darwin', arch: 'arm64',
    builderPlatform: '--mac', builderArch: '--arm64', artifactExtensions: ['.dmg'],
  },
  'mac-x64': {
    name: 'mac-x64', platform: 'darwin', arch: 'x64',
    builderPlatform: '--mac', builderArch: '--x64', artifactExtensions: ['.dmg'],
  },
  'win-x64': {
    name: 'win-x64', platform: 'win32', arch: 'x64',
    builderPlatform: '--win', builderArch: '--x64', artifactExtensions: ['.exe'],
  },
  'linux-x64': {
    name: 'linux-x64', platform: 'linux', arch: 'x64',
    builderPlatform: '--linux', builderArch: '--x64', artifactExtensions: ['.AppImage'],
  },
  'linux-arm64': {
    name: 'linux-arm64', platform: 'linux', arch: 'arm64',
    builderPlatform: '--linux', builderArch: '--arm64', artifactExtensions: ['.AppImage'],
  },
}

/**
 * Select a release target and reject hosts that cannot execute its packaged runtime.
 * @param name - Target name, or undefined to package the host's own target.
 * @param hostPlatform - Build-host Node.js platform.
 * @param hostArch - Build-host architecture.
 * @returns The validated target selectors.
 */
export function resolveCiPackageTarget(
  name: string | undefined,
  hostPlatform: NodeJS.Platform = process.platform,
  hostArch: string = process.arch,
): CiPackageTarget {
  const selected = name ?? `${targetOsPrefix(hostPlatform)}-${hostArch}`
  const target = TARGETS[selected]
  if (target === undefined) {
    throw new Error(`ci package: unsupported target ${JSON.stringify(selected)}; expected ${Object.keys(TARGETS).join(', ')}`)
  }
  if (target.platform !== hostPlatform) {
    throw new Error(`ci package: ${target.name} requires a ${target.platform} build host`)
  }
  if (target.platform === 'darwin' && target.arch !== hostArch) {
    throw new Error(`ci package: ${target.name} requires a ${target.arch} build host`)
  }
  return target
}

/**
 * Parse the release packaging command line.
 * @param argv - Arguments after the script entry point.
 * @param hostPlatform - Build-host Node.js platform.
 * @param hostArch - Build-host architecture.
 * @returns The validated release target.
 */
export function parseCiPackageInvocation(
  argv: readonly string[],
  hostPlatform: NodeJS.Platform = process.platform,
  hostArch: string = process.arch,
): CiPackageTarget {
  const { positionals } = parseArgs({ args: [...argv], allowPositionals: true, options: {} })
  if (positionals.length > 1) throw new Error('ci package: expected at most one target')
  return resolveCiPackageTarget(positionals[0], hostPlatform, hostArch)
}

/**
 * Run one pnpm command and inherit its output.
 * @param args - Arguments passed to the pnpm CLI.
 * @param cwd - Working directory for the command.
 * @param env - Environment for the command.
 * @returns Resolves when the command exits successfully.
 */
function runPnpm(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
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
 * Build one release artifact from source and report the files the upload step collects.
 * @param target - Validated release target.
 * @returns Resolves after the artifact directory is populated.
 */
export async function packageCiTarget(target: CiPackageTarget): Promise<void> {
  const buildPaths = desktopTargetBuildPaths(target.name)
  const buildEnv: NodeJS.ProcessEnv = { ...process.env }
  const targetEnv: NodeJS.ProcessEnv = {
    ...buildEnv,
    DSH_DESKTOP_TARGET_PLATFORM: target.platform,
    DSH_DESKTOP_TARGET_ARCH: target.arch,
  }
  // The bundled NSIS decoder cannot extract 7-Zip's automatic ARM64-filtered entries.
  const builderEnv: NodeJS.ProcessEnv = target.platform === 'win32'
    ? { ...targetEnv, ELECTRON_BUILDER_7Z_FILTER: 'BCJ', CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
    : targetEnv
  await runPnpm(['run', 'build:official'], REPOSITORY_ROOT, buildEnv)
  await runPnpm(['run', 'release:pack', '--family', 'dsh', '--out', buildPaths.packedDsh], REPOSITORY_ROOT, buildEnv)
  await runPnpm(['--dir', 'apps/desktop-host', 'pack', '--pack-destination', buildPaths.packedDsh], REPOSITORY_ROOT, buildEnv)
  await runPnpm(['run', 'release:pack', '--family', 'vendor', '--out', buildPaths.packedVendor], REPOSITORY_ROOT, buildEnv)
  rmSync(buildPaths.packedLandlock, { recursive: true, force: true })
  mkdirSync(buildPaths.packedLandlock, { recursive: true })
  await runPnpm(['--dir', 'native/system', 'run', 'build:ts'], REPOSITORY_ROOT, buildEnv)
  await runPnpm([
    '--dir', 'native/system/packages/entry', 'pack', '--pack-destination', buildPaths.packedLandlock,
  ], REPOSITORY_ROOT, buildEnv)
  await runPnpm(['run', 'prepare:runtime'], APP_ROOT, targetEnv)
  await runPnpm(['run', 'prepare:packages'], APP_ROOT, targetEnv)
  // Ad-hoc signing happens inside the bundle, so the runtime tree stays unsigned here.
  await runPnpm(['run', 'prepare:dsh', '--ad-hoc'], APP_ROOT, targetEnv)
  await runPnpm([
    'exec', 'electron-builder', '--config', join('scripts', 'ci-builder-config.mjs'),
    target.builderPlatform, target.builderArch, '--publish', 'never',
  ], APP_ROOT, builderEnv)
  const artifacts = readdirSync(buildPaths.artifacts)
    .filter(name => target.artifactExtensions.some(extension => name.endsWith(extension)))
  if (artifacts.length === 0) throw new Error(`ci package: ${target.name} produced no artifact in ${buildPaths.artifacts}`)
  for (const name of artifacts) process.stdout.write(`${join(buildPaths.artifacts, name)}\n`)
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  await packageCiTarget(parseCiPackageInvocation(process.argv.slice(2)))
}
