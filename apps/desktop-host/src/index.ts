/** Launch the Desktop profile through the Web application and report its URL to the desktop shell. */

import { delimiter, join } from 'node:path'
import { inspect } from 'node:util'
import {
  initProfile, loadLayeredEnv, loadProfileDirectory, PROFILE_TEMPLATES, reportSkippedBundles,
  type ProfileTemplate,
} from '@mutantcat/dsh-app-boot'
import { runProfile } from '@mutantcat/dsh/profile-boot'
import type {} from '@mutantcat/dsh-client-connection'
import type {} from '@mutantcat/dsh-host-webserver'
import type {} from '@mutantcat/dsh-deepseek-account'
import { resolveDshHome } from '@mutantcat/dsh-home-paths'
import * as desktopOffice from './office.ts'
import { createDesktopShellTransport } from './shell-transport.ts'

import { installDesktopUpdateTaskControl } from './update-tasks.ts'
import { installDesktopQuitInspection } from './quit-inspection.ts'
import { installPlatformSessionPublisher } from './platform-session.ts'
import { installOfficeEngineResolution } from './office-engine.ts'

/** Fixed engine port; the shell capability trusts only the loopback origin. */
const ENGINE_PORT = 19387
/** Built-in bundles the desktop profile activates when its manifest is absent. */
const WEB_PROFILE_BUNDLES = (PROFILE_TEMPLATES.web as ProfileTemplate).bundles
/** How long a graceful stop a SIGTERM requests may take before the process exits anyway. */
const HOST_SHUTDOWN_BOUND_MS = 4_500

const shell = createDesktopShellTransport()

async function main(): Promise<void> {
  const runtimeDir = process.argv[2] as string
  const projectDir = process.argv[3] as string
  installOfficeEngineResolution(runtimeDir)
  // A shell that runs no package manager needs the host to write the profile manifest;
  // an initialized profile is left untouched.
  initProfile(projectDir, WEB_PROFILE_BUNDLES)
  const installAnchor = join(runtimeDir, 'node_modules', '@mutantcat', 'dsh', 'package.json')
  const profile = loadProfileDirectory('dsh', projectDir, installAnchor)
  reportSkippedBundles('dsh', profile)
  const application = runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: 'desktop',
    resolvedProfile: { profile, installAnchor },
    patchFiles: [],
    args: ['--no-open', '--port', String(ENGINE_PORT)],
    ...(process.argv[5] === undefined ? {} : {
      packageManager: {
        command: process.execPath,
        args: ['--expose-internals', process.argv[5]],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
          PATH: `${process.argv[6] ?? ''}${delimiter}${process.env.PATH ?? ''}`,
        },
      },
    }),
  })
  let stopping: Promise<void> | undefined
  const control: {
    updateTasks?: ReturnType<typeof installDesktopUpdateTaskControl>
    quitInspection?: ReturnType<typeof installDesktopQuitInspection>
  } = {}
  const stop = (): Promise<void> => stopping ??= (async () => {
    // Startup failure is reported by main; shutdown only owns a tree that booted.
    const running = await application.catch(() => undefined)
    await running?.shutdown.shutdown(0)
    await shell.send({ type: 'shutdown-complete' })
    shell.close()
  })()
  shell.onMessage((message: unknown) => {
    if (typeof message !== 'object' || message === null || !('type' in message)) return
    if (message.type === 'shutdown') { void stop(); return }
    if (message.type === 'quit-inspection') {
      if (!('requestId' in message) || !Number.isSafeInteger(message.requestId)) return
      const requestId = message.requestId
      void (async () => {
        try {
          if (stopping !== undefined || control.quitInspection === undefined) throw new Error('desktop quit: Host is unavailable')
          const inspection = await control.quitInspection()
          await shell.send({ type: 'quit-inspection', requestId, ...inspection })
        } catch (error) {
          // The shell treats an unknown state as interruptible work and asks before quitting.
          await shell.send({ type: 'quit-inspection', requestId, activeTasks: true, scheduledTasks: false,
            error: error instanceof Error ? error.message : String(error) })
        }
      })().catch((error: unknown) => { console.error(error) })
      return
    }
    if (message.type !== 'update-tasks' || !('requestId' in message) || !Number.isSafeInteger(message.requestId)
      || !('action' in message) || !['inspect', 'lock', 'unlock'].includes(String(message.action))) return
    void (async () => {
      try {
        if (stopping !== undefined || control.updateTasks === undefined) throw new Error('desktop update: Host is unavailable')
        const active = await control.updateTasks(message.action as 'inspect' | 'lock' | 'unlock')
        await shell.send({ type: 'update-tasks', requestId: message.requestId, active })
      } catch (error) {
        await shell.send({ type: 'update-tasks', requestId: message.requestId, active: true,
          error: error instanceof Error ? error.message : String(error) })
      }
    })().catch((error: unknown) => { console.error(error) })
  })
  shell.onDisconnect(() => { void stop() })
  process.once('SIGTERM', () => {
    // A system shutdown, or a host a newer launch is replacing: flush like a shell-requested stop.
    void stop().then(
      () => { process.exit(0) },
      () => { process.exit(1) },
    )
    // A boot that never settles must not outlive the grace a takeover or a system shutdown allows.
    setTimeout(() => { process.exit(0) }, HOST_SHUTDOWN_BOUND_MS).unref()
  })
  const { ctx } = await application
  control.updateTasks = installDesktopUpdateTaskControl(ctx)
  control.quitInspection = installDesktopQuitInspection(ctx)
  await ctx.plugin(desktopOffice, {
    runtimeDir,
    source: process.argv[4] ?? join(runtimeDir, '..', 'runtime', 'primary-runtime'),
    root: join(resolveDshHome(), 'dsh-runtimes', 'dsh-primary-runtime'),
  })
  installPlatformSessionPublisher(ctx, (session) => {
    if (shell.connected) {
      void shell.send({ type: 'platform-session', session }).catch((error: unknown) => { console.error(error) })
    }
  })
  const url = ctx.connection.authenticatedUrl(`http://127.0.0.1:${String(ctx.webServer.port)}`)
  // A shell that already disappeared never receives the URL, so skip the injection read.
  if (shell.connected) {
    await shell.send({ type: 'ready', url, injections: ctx.webServer.collectIndexInjections() })
      .catch((error: unknown) => { console.error(error) })
  }
}

/** Upper bound of the startup diagnostic carried to the shell; the head holds the message and stack. */
const MAX_FATAL_DIAGNOSTIC_CHARS = 64 * 1024

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    // The shell receives the complete inspected error here, not through stderr:
    // stderr bytes and this event race, and the shell reports the first failure it sees.
    const diagnostic = inspect(error, { depth: 4, maxArrayLength: 50 }).slice(0, MAX_FATAL_DIAGNOSTIC_CHARS)
    void shell.send({ type: 'fatal', message, diagnostic })
      .catch((failure: unknown) => { console.error(failure) })
    console.error(error)
    process.exitCode = 1
    shell.close()
  })
}
