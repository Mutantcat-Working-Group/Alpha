/** Tauri target mapping and the bundle layout each installed artifact is read from. */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  tauriArtifactExtension,
  tauriBundleDirectory,
  tauriReleaseAssetName,
  tauriTargetBundle,
  tauriTargetTriple,
} from '../scripts/tauri-targets.ts'

interface LinuxBundleConfig {
  bundle: {
    resources: unknown
    linux: { appimage: { files: Record<string, string> } }
  }
}

interface BundleConfig {
  productName: unknown
}

const SRC_TAURI = resolve(import.meta.dirname, '../src-tauri')

describe('tauri targets', () => {
  it('compiles every platform for its own Rust triple', () => {
    expect(tauriTargetTriple('mac-arm64')).toBe('aarch64-apple-darwin')
    expect(tauriTargetTriple('mac-x64')).toBe('x86_64-apple-darwin')
    expect(tauriTargetTriple('win-x64')).toBe('x86_64-pc-windows-msvc')
    expect(tauriTargetTriple('linux-x64')).toBe('x86_64-unknown-linux-gnu')
    expect(tauriTargetTriple('linux-arm64')).toBe('aarch64-unknown-linux-gnu')
  })

  it('reads each artifact from the directory its bundler writes', () => {
    // tauri-bundler writes the disk image into `bundle/dmg`; `bundle/macos` keeps
    // the application bundle the image was created from.
    expect(tauriBundleDirectory(tauriTargetBundle('mac-arm64'))).toBe('dmg')
    expect(tauriBundleDirectory(tauriTargetBundle('mac-x64'))).toBe('dmg')
    expect(tauriBundleDirectory(tauriTargetBundle('win-x64'))).toBe('nsis')
    expect(tauriBundleDirectory(tauriTargetBundle('linux-x64'))).toBe('appimage')
    expect(tauriBundleDirectory(tauriTargetBundle('linux-arm64'))).toBe('appimage')
    expect(tauriArtifactExtension('dmg')).toBe('.dmg')
    expect(tauriArtifactExtension('nsis')).toBe('.exe')
    expect(tauriArtifactExtension('appimage')).toBe('.AppImage')
  })

  it('names each release asset after its platform and architecture', () => {
    expect(tauriReleaseAssetName('win-x64', '1.0.20260924')).toBe('Alpha-1.0.20260924-x64-setup.exe')
    expect(tauriReleaseAssetName('mac-arm64', '1.0.20260924')).toBe('Alpha-1.0.20260924-arm64-mac.dmg')
    expect(tauriReleaseAssetName('mac-x64', '1.0.20260924')).toBe('Alpha-1.0.20260924-x64-mac.dmg')
    expect(tauriReleaseAssetName('linux-x64', '1.0.20260924')).toBe('Alpha-1.0.20260924-x86_64.AppImage')
    expect(tauriReleaseAssetName('linux-arm64', '1.0.20260924')).toBe('Alpha-1.0.20260924-aarch64.AppImage')
  })
})

describe('linux bundle payload', () => {
  it('ships the payload beside the desktop entry instead of under usr/lib', () => {
    const config = JSON.parse(readFileSync(join(SRC_TAURI, 'tauri.linux.conf.json'), 'utf8')) as LinuxBundleConfig
    const { productName } = JSON.parse(readFileSync(join(SRC_TAURI, 'tauri.conf.json'), 'utf8')) as BundleConfig
    if (typeof productName !== 'string') throw new Error('tauri.conf.json declares no product name')

    // Bundle resources are written under usr/lib, where the linuxdeploy run the
    // bundle performs resolves the dependencies of every ELF file it finds
    // there and aborts when a payload library needs one the host does not carry.
    expect(config.bundle.resources).toEqual([])
    const files = config.bundle.linux.appimage.files
    for (const destination of Object.keys(files)) {
      expect(destination.startsWith('usr/share/')).toBe(true)
      expect(destination).not.toContain('usr/lib')
    }
    // The map's key is the destination under the bundle's `usr`; its value is the
    // staged payload, so the payload path read at runtime must match this key.
    expect(files[`usr/share/${productName}/runtime`]).toBe('staging/runtime')
  })

  it('resolves the payload where the Linux bundle places it', () => {
    const source = readFileSync(join(SRC_TAURI, 'src/lib.rs'), 'utf8')
    expect(source).toContain('.join("share")')
    expect(source).toContain('.join("runtime")')
    // macOS and Windows keep the payload in the resource directory the
    // `bundle.resources` map targets.
    expect(source).toContain('BaseDirectory::Resource')
  })
})
