/** Launch the Desktop profile through the Web application and report its URL to the desktop shell. */

/** Fixed engine port; the shell capability trusts only the loopback origin. */
const ENGINE_PORT = 19387
/** Built-in bundles the desktop profile activates when its manifest is absent. */
const WEB_PROFILE_BUNDLES = (PROFILE_TEMPLATES.web as ProfileTemplate).bundles

import { delimiter, join } from 'node:path'
import { initProfile, loadLayeredEnv, loadProfileDirectory, PROFILE_TEMPLATES, type ProfileTemplate } from '@mutantcat/dsh-app-boot'
import { runProfile } from '@mutantcat/dsh/profile-boot'
import type {} from '@mutantcat/dsh-client-connection'
import type {} from '@mutantcat/dsh-host-webserver'
import { resolveDshHome } from '@mutantcat/dsh-home-paths'
import * as desktopOffice from './office.ts'

import { installDesktopUpdateTaskControl } from './update-tasks.ts'
import { createDesktopShellTransport } from './shell-transport.ts'
import { runRecoverMain } from './recover.ts'
import { claimHostLock, HOST_SHUTDOWN_BOUND_MS } from './host-lock.ts'

const shell = createDesktopShellTransport()

async function main(): Promise<void> {
  const runtimeDir = process.argv[2] as string
  const projectDir = process.argv[3] as string
  // A host an earlier launch left running owns the engine port; stop it before booting.
  await claimHostLock(projectDir, ENGINE_PORT)
  // The desktop shell runs no package manager, so the host writes the profile manifest
  // the Electron main process used to create; existing manifests are left untouched.
  initProfile(projectDir, WEB_PROFILE_BUNDLES)
  const installAnchor = join(runtimeDir, 'node_modules', '@mutantcat', 'dsh', 'package.json')
  const profile = loadProfileDirectory('dsh', projectDir, installAnchor)
  const application = runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: 'desktop',
    resolutionMode: process.argv[5] === 'runtime' ? 'runtime' : 'link',
    resolvedProfile: { profile, installAnchor },
    patchFiles: [],
    args: ['--no-open', '--port', String(ENGINE_PORT)],
    ...(process.argv[6] === undefined ? {} : {
      packageManager: {
        command: process.execPath,
        args: ['--expose-internals', process.argv[6]],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
          PATH: `${process.argv[7] ?? ''}${delimiter}${process.env.PATH ?? ''}`,
        },
      },
    }),
  })
  let stopping: Promise<void> | undefined
  const control: { updateTasks?: ReturnType<typeof installDesktopUpdateTaskControl> } = {}
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
    // A takeover from a newer host, or a system shutdown: flush like a shell-requested stop.
    void stop().then(
      () => { process.exit(0) },
      () => { process.exit(1) },
    )
    // A boot that never settles must not outlive the takeover grace the new host allows.
    setTimeout(() => { process.exit(0) }, HOST_SHUTDOWN_BOUND_MS).unref()
  })
  const { ctx } = await application
  control.updateTasks = installDesktopUpdateTaskControl(ctx)
  await ctx.plugin(desktopOffice, {
    source: process.argv[4] ?? join(runtimeDir, '..', 'runtime', 'primary-runtime'),
    root: join(resolveDshHome(), 'dsh-runtimes', 'dsh-primary-runtime'),
  })
  const url = ctx.connection.authenticatedUrl(`http://127.0.0.1:${String(ctx.webServer.port)}`)
  // A shell that already disappeared never receives the URL, so skip the injection read.
  if (shell.connected) await shell.send({ type: 'ready', url, injections: ctx.webServer.collectIndexInjections() })
}

if (import.meta.main) {
  if (process.argv.includes('--recover')) {
    void runRecoverMain(process.argv[process.argv.indexOf('--recover') + 1] ?? '', shell)
      .then((code) => { process.exitCode = code })
  } else {
    launchHost()
  }
}

/** Boot the Desktop profile and report startup failures to the shell. */
function launchHost(): void {
  main().catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    await shell.send({ type: 'fatal', message }).catch((failure: unknown) => { console.error(failure) })
    console.error(error)
    process.exitCode = 1
    shell.close()
  })
}
