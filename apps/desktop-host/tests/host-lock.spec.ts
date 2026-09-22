/** Host pidfile claim: a fresh launch stops the host an earlier launch left running. */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { expect, it } from 'vitest'
import { claimHostLock } from '../src/host-lock.ts'

const PID_FILENAME = 'host.pid'
const hostLockModule = new URL('../src/host-lock.ts', import.meta.url).href

/**
 * Read the pidfile contents, or undefined when the file is absent.
 * @param dir - Project directory holding the pidfile.
 * @returns Trimmed file contents.
 */
function readPidFile(dir: string): string | undefined {
  try {
    return readFileSync(join(dir, PID_FILENAME), 'utf8').trim()
  } catch {
    return undefined
  }
}

/** Run one assertion against a project directory removed afterwards. */
async function withProjectDir(assertion: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'host-lock-'))
  try {
    await assertion(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Reserve an unused loopback port for one former host. */
async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => { resolve(port) })
    })
  })
}

/** A foreign process holding no port that lives until it is signaled. */
function sleeper(): { pid: number; exited: Promise<number | null> } {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
  const exited = new Promise<number | null>((resolve) => { child.once('exit', resolve) })
  return { pid: child.pid!, exited }
}

/** A former host that serves the engine port and closes it after SIGTERM. */
async function formerHost(behavior: 'graceful' | 'stubborn'): Promise<{ pid: number; port: number; exited: Promise<number | null> }> {
  const port = await reservePort()
  const delayMs = behavior === 'graceful' ? 900 : 0
  const script = [
    "import { createServer } from 'node:net'",
    'const server = createServer()',
    `server.listen(${String(port)}, '127.0.0.1', () => {`,
    '  if (process.send !== undefined) process.send("listening")',
    '})',
    behavior === 'stubborn'
      ? "process.on('SIGTERM', () => { /* refuse the graceful stop */ })"
      : `process.on('SIGTERM', () => { setTimeout(() => { server.close(() => process.exit(0)) }, ${String(delayMs)}) })`,
  ].join('\n')
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  await new Promise<void>((resolve) => { child.once('message', () => { resolve() }) })
  const exited = new Promise<number | null>((resolve) => { child.once('exit', resolve) })
  return { pid: child.pid!, port, exited }
}

it('records the claiming process and keeps the claim on a re-claim', async () => {
  await withProjectDir(async (dir) => {
    await claimHostLock(dir, 39761)
    await claimHostLock(dir, 39761)
    expect(readPidFile(dir)).toBe(String(process.pid))
  })
})

it('replaces a pidfile whose owner already died', async () => {
  await withProjectDir(async (dir) => {
    const dead = spawn(process.execPath, ['-e', 'process.exit(7)'])
    await new Promise((resolve) => { dead.once('exit', resolve) })
    writeFileSync(join(dir, PID_FILENAME), `${String(dead.pid)}\n`)
    await claimHostLock(dir, 39761)
    expect(readPidFile(dir)).toBe(String(process.pid))
  })
})

it('replaces an unparsable pidfile', async () => {
  await withProjectDir(async (dir) => {
    writeFileSync(join(dir, PID_FILENAME), 'not-a-pid\n')
    await claimHostLock(dir, 39761)
    expect(readPidFile(dir)).toBe(String(process.pid))
  })
})

it('stops a live former host that holds no port', async () => {
  await withProjectDir(async (dir) => {
    const former = sleeper()
    writeFileSync(join(dir, PID_FILENAME), `${String(former.pid)}\n`)
    await claimHostLock(dir, 39761)
    expect(readPidFile(dir)).toBe(String(process.pid))
    await former.exited
  })
})

it('waits for a former host to release the engine port', async () => {
  await withProjectDir(async (dir) => {
    const former = await formerHost('graceful')
    writeFileSync(join(dir, PID_FILENAME), `${String(former.pid)}\n`)
    const started = Date.now()
    await claimHostLock(dir, former.port)
    const waited = Date.now() - started
    // The port-owner wait ends with the graceful close; a process-only wait would burn the full grace.
    expect(waited).toBeGreaterThanOrEqual(800)
    expect(waited).toBeLessThan(4000)
    expect(readPidFile(dir)).toBe(String(process.pid))
    await former.exited
  })
})

it('forces a former host that survives SIGTERM', async () => {
  await withProjectDir(async (dir) => {
    const former = await formerHost('stubborn')
    writeFileSync(join(dir, PID_FILENAME), `${String(former.pid)}\n`)
    const started = Date.now()
    await claimHostLock(dir, former.port)
    // The graceful grace passes first, then the forced stop and its short re-poll.
    expect(Date.now() - started).toBeGreaterThanOrEqual(5000)
    expect(readPidFile(dir)).toBe(String(process.pid))
    await former.exited
  })
}, 20000)

it('clears the pidfile when the claiming process exits', async () => {
  await withProjectDir(async (dir) => {
    const require = createRequire(import.meta.url)
    const child = spawn(process.execPath, [
      '--import', require.resolve('tsx/esm'),
      '-e', `import { claimHostLock } from ${JSON.stringify(hostLockModule)}; await claimHostLock(${JSON.stringify(dir)}, 39761)`,
    ], { stdio: 'ignore' })
    const code = await new Promise<number | null>((resolve) => { child.once('exit', resolve) })
    expect(code).toBe(0)
    expect(existsSync(join(dir, PID_FILENAME))).toBe(false)
  })
})
