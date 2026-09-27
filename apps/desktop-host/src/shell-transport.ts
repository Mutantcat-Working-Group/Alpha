/**
 * Control channel between a desktop shell and this host process. A Node IPC
 * channel carries messages when the launching shell provides one (the
 * Electron shell); otherwise stdout carries host events and stdin carries
 * shell commands, both as newline-delimited JSON (the Tauri shell).
 */

/** Bidirectional control channel owned by the desktop shell. */
export interface DesktopShellTransport {
  /**
   * Deliver one event to the shell.
   * @param message - JSON-serializable event payload.
   * @returns Completion once the shell accepted the message.
   */
  send(message: object): Promise<void>
  /**
   * Register the shell-command listener; one listener owns the channel.
   * @param listener - Receives parsed shell commands.
   */
  onMessage(listener: (message: unknown) => void): void
  /** Whether the shell still receives events on this channel. */
  readonly connected: boolean
  /**
   * Register the channel-loss listener; one listener owns the channel.
   * @param listener - Invoked once when the shell disappears.
   */
  onDisconnect(listener: () => void): void
  /** Release channel ownership after shutdown completed. */
  close(): void
}

/**
 * Create the control channel for the current process. stdout is reserved for
 * protocol events once no IPC channel exists, so host diagnostics stay on
 * stderr; unparsable stdout noise from plugins is discarded.
 * @returns The transport matching this process's launch mode.
 */
export function createDesktopShellTransport(): DesktopShellTransport {
  if (process.connected && process.send !== undefined) {
    return {
      send: (message: object) => new Promise<void>((resolve, reject) => {
        if (!process.connected) { resolve(); return }
        process.send?.(message, (error: Error | null) => { if (error === null) resolve(); else reject(error) })
      }),
      onMessage: (listener) => { process.on('message', listener) },
      onDisconnect: (listener) => { process.once('disconnect', listener) },
      close: () => { /* the IPC channel is owned by Node */ },
      get connected() { return process.connected },
    }
  }
  let listener: ((message: unknown) => void) | undefined
  let open = true
  let disconnect: (() => void) | undefined
  let pending = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => {
    pending += chunk
    let end = pending.indexOf('\n')
    while (end >= 0) {
      const line = pending.slice(0, end).trim()
      pending = pending.slice(end + 1)
      if (line !== '' && listener !== undefined) {
        try { listener(JSON.parse(line)) }
        catch { /* stdout noise from plugins never enters the protocol */ }
      }
      end = pending.indexOf('\n')
    }
  })
  process.stdin.on('end', () => {
    open = false
    disconnect?.()
  })
  return {
    send: (message: object) => new Promise<void>((resolve) => {
      process.stdout.write(`${JSON.stringify(message)}\n`, () => { resolve() })
    }),
    onMessage: (next) => { listener = next },
    onDisconnect: (next) => { disconnect = next },
    close: () => { open = false; process.stdin.pause() },
    get connected() { return open },
  }
}
