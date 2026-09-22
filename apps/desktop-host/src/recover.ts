/** Profile recovery for a desktop shell that stopped the Host: disable third-party bundles. */

import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { PROFILE_TEMPLATES, sanitizeProfile, type ProfileTemplate } from '@mutantcat/dsh-app-boot'
import type { DesktopShellTransport } from './shell-transport.ts'

const WEB_PROFILE = PROFILE_TEMPLATES.web as ProfileTemplate

/**
 * Back up the desktop profile patch and retain only the Web bundles under the profile lock.
 * The caller must stop the Host first; a live lock owner refuses recovery.
 * @param projectDir - Desktop profile directory owning the patch file.
 * @returns Backup path after the locked profile write, or undefined when the patch was absent.
 */
export function recoverDesktopProfile(projectDir: string): string | undefined {
  mkdirSync(projectDir, { recursive: true, mode: 0o700 })
  const lockPath = join(realpathSync(projectDir), 'lock')
  let descriptor: number
  try {
    descriptor = openSync(lockPath, 'wx', 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const lock = lstatSync(lockPath)
    if (lock.isSymbolicLink() || !lock.isFile()) throw new Error('desktop project: profile lock is not a regular file')
    const owner = Number.parseInt(readFileSync(lockPath, 'utf8').trim(), 10)
    let active = !Number.isSafeInteger(owner) || owner <= 0
    if (!active) {
      try {
        process.kill(owner, 0)
        active = true
      } catch (signalError) {
        active = (signalError as NodeJS.ErrnoException).code !== 'ESRCH'
      }
    }
    if (active) throw new Error('desktop project: another profile operation is active')
    unlinkSync(lockPath)
    descriptor = openSync(lockPath, 'wx', 0o600)
  }
  try {
    writeSync(descriptor, `${String(process.pid)}\n`)
    fsyncSync(descriptor)
    return sanitizeProfile('dsh', projectDir, WEB_PROFILE.bundles)
  } finally {
    closeSync(descriptor)
    unlinkSync(lockPath)
  }
}

/**
 * Run one recovery request and report its outcome to the launching shell.
 * @param projectDir - Desktop profile directory passed by the shell.
 * @param shell - Control channel of this recovery process.
 * @returns Process exit code: 0 after a locked profile write, 1 after a reported failure.
 */
export async function runRecoverMain(projectDir: string, shell: DesktopShellTransport): Promise<number> {
  try {
    const backup = recoverDesktopProfile(projectDir)
    await shell.send({ type: 'recover-complete', backup })
    return 0
  } catch (error) {
    await shell.send({ type: 'fatal', message: error instanceof Error ? error.message : String(error) })
    return 1
  } finally {
    shell.close()
  }
}
