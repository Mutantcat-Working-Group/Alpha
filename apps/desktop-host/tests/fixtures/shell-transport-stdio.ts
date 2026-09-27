/** Drive the stdio control channel so the parent can assert its protocol. */

import { createDesktopShellTransport } from '../../src/shell-transport.ts'

const shell = createDesktopShellTransport()
shell.onMessage((message) => { void shell.send({ type: 'echo', message }) })
shell.onDisconnect(() => { void shell.send({ type: 'closed' }) })
await shell.send({ type: 'listening' })
