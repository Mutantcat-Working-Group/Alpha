/** The shared version agreement between the workspace root and the Tauri shell. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP_ROOT = resolve(import.meta.dirname, '..')
const SRC_TAURI = resolve(APP_ROOT, 'src-tauri')

/**
 * Read one file staged inside the Tauri shell.
 * @param name - file name inside `src-tauri`.
 * @returns The file's text.
 */
function readTauriFile(name: string): string {
  return readFileSync(resolve(SRC_TAURI, name), 'utf8')
}

describe('desktop shell version', () => {
  it('restates the workspace version in every file Tauri and Cargo build the shell from', () => {
    const workspace = JSON.parse(
      readFileSync(resolve(APP_ROOT, '../../package.json'), 'utf8'),
    ) as { version?: unknown }

    expect(typeof workspace.version).toBe('string')
    // Tauri names the installer, the DMG, and the AppImage after the bundle
    // version, so a shell left at the previous release publishes assets named
    // for it; the Cargo declarations carry the same version into the binary.
    expect((JSON.parse(readTauriFile('tauri.conf.json')) as { version?: unknown }).version).toBe(workspace.version)
    expect(/^version = "([^"]+)"/m.exec(readTauriFile('Cargo.toml'))?.[1]).toBe(workspace.version)
    expect(
      /\[\[package\]\]\r?\nname = "alpha-desktop"\r?\nversion = "([^"]+)"/.exec(readTauriFile('Cargo.lock'))?.[1],
    ).toBe(workspace.version)
  })
})
