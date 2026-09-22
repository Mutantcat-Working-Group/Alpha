/** Single-instance claim on the engine directory: a new host stops the host an earlier launch left running. */

import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'

/** File inside the desktop project directory recording the host process that owns it. */
const HOST_PID_FILENAME = 'host.pid'

/** How long a claiming host waits for the former host to honor SIGTERM before forcing one. */
const TAKEOVER_GRACE_MS = 5000

/** How long a former host may take to disappear after the forced kill. */
const TAKEOVER_FORCE_MS = 1000

/** Interval between liveness polls while a former host shuts down. */
const TAKEOVER_POLL_MS = 100

/**
 * How long a former host may take to finish a graceful stop before the claiming host
 * gives up waiting and kills it. A host mid-flush exits at its own bound, safely under
 * this grace, so a takeover never escalates to a forced stop mid-handoff.
 */
export const HOST_SHUTDOWN_BOUND_MS = TAKEOVER_GRACE_MS - 500
/**
 * Read the process id recorded in the host pidfile.
 * @param pidPath - Absolute pidfile path inside the project directory.
 * @returns The recorded process id, or undefined when the file is absent or unparsable.
 */
function readHostPid(pidPath: string): number | undefined {
  let content: string
  try {
    content = readFileSync(pidPath, 'utf8')
  } catch {
    return undefined
  }
  const pid = Number.parseInt(content.trim(), 10)
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
}

/**
 * Whether a process id still names a live process.
 * @param pid - Process id recorded by a former host.
 * @returns True when the id is live for this host; an unsignalable id counts as live.
 */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/**
 * Whether the engine port still accepts a connection.
 * @param port - Fixed engine port claimed by the desktop shell.
 * @returns True when a listener answers there.
 */
function portAnswers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    const settle = (answer: boolean): void => { socket.destroy(); resolve(answer) }
    socket.once('connect', () => { settle(true) })
    socket.once('error', () => { settle(false) })
  })
}

/** Wait one poll interval without blocking the reaping this host performs on its own children. */
async function settle(): Promise<void> {
  await new Promise((resolve) => { setTimeout(resolve, TAKEOVER_POLL_MS) })
}

/**
 * Stop the host an earlier launch left running. Its own SIGTERM handler flushes the
 * profile handoff, so the graceful wait ends long before the forced kill. The port is
 * the ownership signal: a former host whose parent died before reaping it stays a
 * zombie entry, and a zombie holds no listener.
 * @param pid - Process id recorded when that host claimed the project directory.
 * @param port - Fixed engine port the former host served.
 * @returns True once the process or the port is gone; false when both outlived the force.
 */
async function stopFormerHost(pid: number, port: number): Promise<boolean> {
  const gone = async (): Promise<boolean> => !processAlive(pid) || !await portAnswers(port)
  try {
    process.kill(pid, 'SIGTERM')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true
    // EPERM: the id is live but this host may not signal it; the forced stop retries.
  }
  const deadline = Date.now() + TAKEOVER_GRACE_MS
  while (Date.now() < deadline) {
    if (await gone()) return true
    await settle()
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // The process died between the last poll and the signal.
  }
  const forced = Date.now() + TAKEOVER_FORCE_MS
  while (Date.now() < forced) {
    if (await gone()) return true
    await settle()
  }
  return false
}

/**
 * Remove the pidfile when this host exits; a later claim's own file stays in place.
 * @param pidPath - Absolute pidfile path inside the project directory.
 * @returns Nothing.
 */
function releaseHostPid(pidPath: string): void {
  if (readHostPid(pidPath) !== process.pid) return
  try {
    rmSync(pidPath, { force: true })
  } catch {
    // A read-only data directory leaves the pidfile to the next launch's takeover.
  }
}

/**
 * Claim the desktop project directory for this host process.
 *
 * The engine port is fixed, so a host left running by a crashed or force-killed shell
 * would refuse the web server and fail the launch. The pidfile names the former owner
 * when one wrote it: a live owner stops first, a dead id is only a stale file. The claim
 * is not atomic, and two hosts launched inside the same write window can both boot; the
 * shell single-instance guard is what normally keeps launches serialized.
 * @param projectDir - Desktop profile directory the host and its former owner share.
 * @param port - Fixed engine port this host is about to serve.
 * @returns Nothing; throws when a live former owner survived the forced stop.
 */
export async function claimHostLock(projectDir: string, port: number): Promise<void> {
  const pidPath = join(projectDir, HOST_PID_FILENAME)
  mkdirSync(projectDir, { recursive: true, mode: 0o700 })
  const former = readHostPid(pidPath)
  if (former !== undefined && former !== process.pid && processAlive(former)) {
    if (!await stopFormerHost(former, port)) {
      throw new Error(`desktop project: former host ${String(former)} refused to stop`)
    }
  }
  const descriptor = openSync(pidPath, 'w', 0o600)
  try {
    writeSync(descriptor, `${String(process.pid)}\n`)
  } finally {
    closeSync(descriptor)
  }
  process.on('exit', () => { releaseHostPid(pidPath) })
}
