/** Profile recovery: disable third-party bundles under the profile lock. */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PROFILE_PATCH_FILENAME,
  PROFILE_TEMPLATES,
  initProfile,
  readProfileManifest,
} from '@mutantcat/dsh-app-boot'
import { expect, it } from 'vitest'
import { recoverDesktopProfile, runRecoverMain } from '../src/recover.ts'
import type { DesktopShellTransport } from '../src/shell-transport.ts'

const PATCH_BODY = '- id: third-party\n  disabled: true\n'

/** Create one initialized desktop profile and remove it afterwards. */
function withProfile(assertion: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'desktop-recover-'))
  initProfile(dir, ['@mutantcat/dsh-third-party'])
  return (async () => {
    try { await assertion(dir) }
    finally { rmSync(dir, { recursive: true, force: true }) }
  })()
}

/** Record every event one recovery process reports to its shell. */
function recordingShell(): { shell: DesktopShellTransport; events: object[] } {
  const events: object[] = []
  return {
    events,
    shell: {
      send: async (message: object) => { events.push(message) },
      onMessage: () => { /* recovery reads no commands */ },
      onDisconnect: () => { /* recovery has no shutdown path */ },
      close: () => { /* recovery exits on its own */ },
      connected: true,
    },
  }
}

it('backs up the profile patch and retains only the Web bundles', async () => {
  await withProfile((dir) => {
    writeFileSync(join(dir, PROFILE_PATCH_FILENAME), PATCH_BODY)
    const backup = recoverDesktopProfile(dir)
    expect(backup).toBeDefined()
    expect(readFileSync(backup!, 'utf8')).toBe(PATCH_BODY)
    expect(existsSync(join(dir, PROFILE_PATCH_FILENAME))).toBe(false)
    expect(readProfileManifest('dsh', dir).dsh?.profile?.bundles).toEqual([...PROFILE_TEMPLATES.web!.bundles])
  })
})

it('reports a successful recovery to the shell with the backup path', async () => {
  await withProfile(async (dir) => {
    writeFileSync(join(dir, PROFILE_PATCH_FILENAME), PATCH_BODY)
    const { shell, events } = recordingShell()
    expect(await runRecoverMain(dir, shell)).toBe(0)
    expect(events).toHaveLength(1)
    const event = events[0] as { readonly type: string; readonly backup?: string | undefined }
    expect(event.type).toBe('recover-complete')
    expect(event.backup).toBeDefined()
    expect(readFileSync(event.backup!, 'utf8')).toBe(PATCH_BODY)
    expect(existsSync(join(dir, 'lock'))).toBe(false)
  })
})

it('refuses recovery while another profile operation owns the lock', async () => {
  await withProfile(async (dir) => {
    writeFileSync(join(dir, PROFILE_PATCH_FILENAME), PATCH_BODY)
    writeFileSync(join(dir, 'lock'), `${String(process.pid)}\n`)
    const { shell, events } = recordingShell()
    expect(await runRecoverMain(dir, shell)).toBe(1)
    expect(events).toEqual([{ type: 'fatal', message: 'desktop project: another profile operation is active' }])
    expect(readFileSync(join(dir, PROFILE_PATCH_FILENAME), 'utf8')).toBe(PATCH_BODY)
    expect(readFileSync(join(dir, 'lock'), 'utf8')).toBe(`${String(process.pid)}\n`)
  })
})

it('rejects a profile lock that is not a regular file', async () => {
  await withProfile(async (dir) => {
    mkdirSync(join(dir, 'lock'))
    const { shell, events } = recordingShell()
    expect(await runRecoverMain(dir, shell)).toBe(1)
    expect(events).toEqual([{ type: 'fatal', message: 'desktop project: profile lock is not a regular file' }])
  })
})

it('takes over a stale lock left by a process that no longer exists', async () => {
  const owner = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  const exitCode = await new Promise<number | null>((resolve) => { owner.once('exit', resolve) })
  expect(exitCode).toBe(0)
  await withProfile(async (dir) => {
    writeFileSync(join(dir, PROFILE_PATCH_FILENAME), PATCH_BODY)
    writeFileSync(join(dir, 'lock'), `${String(owner.pid)}\n`)
    const { shell, events } = recordingShell()
    expect(await runRecoverMain(dir, shell)).toBe(0)
    expect(events.map(event => 'type' in event ? event.type : undefined)).toEqual(['recover-complete'])
    expect(existsSync(join(dir, PROFILE_PATCH_FILENAME))).toBe(false)
    expect(existsSync(join(dir, 'lock'))).toBe(false)
  })
})
