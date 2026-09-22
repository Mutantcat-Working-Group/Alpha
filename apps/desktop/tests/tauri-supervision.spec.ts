/** Supervision loop that keeps the engine window talking after a suspension. */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC_TAURI = resolve(import.meta.dirname, '../src-tauri')

describe('host supervision', () => {
  // The shell has no Rust test harness; these read the source the same way the Linux
  // bundle spec does, because the wake witness is a platform contract that a future
  // edit can silently drop.
  const source = readFileSync(join(SRC_TAURI, 'src/lib.rs'), 'utf8')
  const body = source.slice(
    source.indexOf('fn supervise('),
    source.indexOf('Whether the machine was suspended since the previous clock reading'),
  )

  it('reads a wake from a watchdog cycle that ran long, not only from clock skew', () => {
    // Windows advances the monotonic clock through a suspension, so the divergence of
    // the two clocks never appears there; the frozen watchdog cycle still does.
    expect(source).toContain('let slept = slept_since(&mut mono, &mut wall)')
    expect(body).toContain(
      'cycle.elapsed() > Duration::from_millis(WATCHDOG_INTERVAL_MS + WAKE_GAP_MS)',
    )
  })

  it('lets a waking engine answer before the host is replaced', () => {
    // A host that survived the suspension may answer only once the machine finished
    // waking, so a few failed probes are tolerated before a session is interrupted.
    expect(source).toContain('const MAX_WAKE_PROBES: u32 = 3')
    expect(body).toContain('if woke && host_running(&handle) && wake_probes < MAX_WAKE_PROBES')
    expect(body).toContain('wake_probes += 1')
  })

  it('revives the window once the engine answers after the wake', () => {
    // The latch outlives the cycle that detected the wake, so a document that survived
    // the suspension is still replaced when the engine answers on a later probe.
    const healthy = body.slice(body.indexOf('if host_running(&handle) && engine_healthy(&url)'))
    expect(healthy).toContain('if woke {')
    expect(healthy).toContain('revive(&handle, &window, &url)')
    expect(healthy).toContain('woke = false')
  })
})
