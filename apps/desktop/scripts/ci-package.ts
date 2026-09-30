/** Resolve one mobile-OS-free release target shared by the Tauri packaging pipeline. */

import { parseArgs } from 'node:util'
import type { DesktopBuildTarget } from './desktop-build-paths.mjs'

/** One supported release artifact target. */
export interface CiPackageTarget {
  readonly name: DesktopBuildTarget
  readonly platform: 'darwin' | 'win32' | 'linux'
  readonly arch: 'arm64' | 'x64'
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
  },
  'mac-x64': {
    name: 'mac-x64', platform: 'darwin', arch: 'x64',
  },
  'win-x64': {
    name: 'win-x64', platform: 'win32', arch: 'x64',
  },
  'win-arm64': {
    name: 'win-arm64', platform: 'win32', arch: 'arm64',
  },
  'linux-x64': {
    name: 'linux-x64', platform: 'linux', arch: 'x64',
  },
  'linux-arm64': {
    name: 'linux-arm64', platform: 'linux', arch: 'arm64',
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
