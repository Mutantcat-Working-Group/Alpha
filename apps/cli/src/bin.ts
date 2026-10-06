#!/usr/bin/env node
/**
 * Command-line entry for Alpha.
 * @module @mutantcat/alpha/bin
 */

/* v8 ignore file -- built-bin acceptance exercises this self-executing dispatch. */

import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadLayeredEnv, StartupError } from '@mutantcat/dsh-app-boot'
import { resolveDshHome } from '@mutantcat/dsh-home-paths'
import { parseAlphaArgs } from './args.ts'
import { reportStartupFailure } from './startup-diagnostics.ts'

// Both the source tree (apps/cli/src) and the bundled bin (apps/cli/lib) sit
// one directory under apps/cli, so the checked-in manifest resolves with the
// same relative hop from either artifact.
function readVersion(): string {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

/**
 * Run the public Alpha command-line interface.
 * @returns a promise that settles when the selected command mode finishes.
 */
export async function runCli(): Promise<void> {
  const version = readVersion()
  const invocation = parseAlphaArgs(process.argv.slice(2), version)

  switch (invocation.mode) {
    case 'profile': {
      const { runProfile } = await import('./profile-boot.ts')
      try {
        await runProfile({
          environment: loadLayeredEnv('alpha'),
          profile: invocation.profile,
          fromDefaultProfile: invocation.fromDefaultProfile,
          patchFiles: invocation.patches,
          args: invocation.args,
        })
      } catch (error) {
        if (!(error instanceof StartupError)) throw error
        await reportStartupFailure(error, { home: resolveDshHome(), version, profile: invocation.profile })
        process.exit(1)
      }
      break
    }
    case 'plugin': {
      const { runPlugin } = await import('./plugin.ts')
      process.exit(await runPlugin(invocation.profile, invocation.args))
      break
    }
    case 'dump-config': {
      const { runDumpConfig } = await import('./dump-config.ts')
      runDumpConfig(
        invocation.profile,
        invocation.defaultOnly,
        invocation.patches,
        invocation.fromDefaultProfile,
      )
      break
    }
    default:
      invocation satisfies never
      throw new Error(`alpha: unhandled invocation mode ${JSON.stringify(invocation)}`)
  }
}

// `import.meta.main` is absent before Node 24.2, and the fallback must still
// detect the documented `npx @mutantcat/alpha` launch, where argv[1] is the
// `node_modules/.bin/alpha` symlink rather than this file. Packaged single-file
// runtimes import this module from a virtual path that `realpathSync` cannot
// resolve, so an unresolvable launcher means the module was imported, not run.
function isProcessEntry(): boolean {
  if (import.meta.main) return true
  const argv1 = process.argv[1]
  if (argv1 === undefined) return false
  try {
    return realpathSync(argv1) === realpathSync(import.meta.filename)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return false
  }
}

if (isProcessEntry()) await runCli()
