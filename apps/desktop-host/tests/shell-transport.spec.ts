/** The stdio control channel used by a shell that provides no Node IPC channel. */

import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const childEntry = fileURLToPath(new URL('./fixtures/shell-transport-stdio.ts', import.meta.url))
const tsxLoader = import.meta.resolve('tsx/esm')
const CHILD_TIMEOUT_MS = 30_000

/** Await one condition, polling because child output arrives asynchronously. */
async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + CHILD_TIMEOUT_MS
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('desktop shell transport fixture did not report in time')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

it('carries host events on stdout and shell commands on stdin as newline-delimited JSON', async () => {
  const child: ChildProcess = spawn(process.execPath, ['--import', tsxLoader, childEntry], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const events: Record<string, unknown>[] = []
  let pending = ''
  let stderr = ''
  child.stdout!.setEncoding('utf8')
  child.stdout!.on('data', (chunk: string) => {
    pending += chunk
    let end = pending.indexOf('\n')
    while (end >= 0) {
      const line = pending.slice(0, end).trim()
      pending = pending.slice(end + 1)
      if (line !== '') events.push(JSON.parse(line) as Record<string, unknown>)
      end = pending.indexOf('\n')
    }
  })
  child.stderr!.setEncoding('utf8')
  child.stderr!.on('data', (chunk: string) => { stderr += chunk })
  const exited = new Promise<number | null>((resolve) => { child.once('exit', resolve) })
  try {
    await waitFor(() => events.some(event => event.type === 'listening'))
    child.stdin!.write('{"type":"shutdown"}\n')
    child.stdin!.write('host diagnostics that are not JSON\n')
    await waitFor(() => events.some(event => event.type === 'echo'))
    child.stdin!.end()
    expect(await exited).toBe(0)
    expect(events).toEqual([
      { type: 'listening' },
      { type: 'echo', message: { type: 'shutdown' } },
      { type: 'closed' },
    ])
    expect(stderr).toBe('')
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
})
