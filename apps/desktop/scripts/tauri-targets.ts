/** Desktop target to Tauri build and release-asset mapping. */

import type { DesktopBuildTarget } from './desktop-build-paths.mjs'

/** Rust target triple for each Desktop target; matches the Node sidecar file suffix. */
const TARGET_TRIPLES: Record<DesktopBuildTarget, string> = {
  'mac-arm64': 'aarch64-apple-darwin',
  'mac-x64': 'x86_64-apple-darwin',
  'win-x64': 'x86_64-pc-windows-msvc',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
}

/** Bundle kind each target ships: DMG on macOS, NSIS on Windows, AppImage on Linux. */
const TARGET_BUNDLES: Record<DesktopBuildTarget, 'dmg' | 'nsis' | 'appimage'> = {
  'mac-arm64': 'dmg',
  'mac-x64': 'dmg',
  'win-x64': 'nsis',
  'linux-x64': 'appimage',
  'linux-arm64': 'appimage',
}

/**
 * Resolve the Rust target triple a Desktop target builds.
 * @param target - Supported Desktop target name.
 * @returns The Rust target triple passed to `tauri build --target`.
 */
export function tauriTargetTriple(target: DesktopBuildTarget): string {
  const triple = TARGET_TRIPLES[target]
  if (triple === undefined) throw new Error(`tauri targets: unsupported target ${target}`)
  return triple
}

/**
 * Resolve the bundle kind a Desktop target publishes.
 * @param target - Supported Desktop target name.
 * @returns The bundle name passed to `tauri build --bundles`.
 */
export function tauriTargetBundle(target: DesktopBuildTarget): 'dmg' | 'nsis' | 'appimage' {
  const bundle = TARGET_BUNDLES[target]
  if (bundle === undefined) throw new Error(`tauri targets: unsupported target ${target}`)
  return bundle
}

/**
 * Resolve the release asset name that carries one target's installable artifact.
 * @param target - Supported Desktop target name.
 * @param version - Product version staged in `src-tauri/tauri.conf.json`.
 * @returns The asset file name uploaded to the release.
 */
export function tauriReleaseAssetName(target: DesktopBuildTarget, version: string): string {
  switch (target) {
    case 'mac-arm64':
      return `Alpha-${version}-arm64-mac.dmg`
    case 'mac-x64':
      return `Alpha-${version}-x64-mac.dmg`
    case 'win-x64':
      return `Alpha-${version}-x64-setup.exe`
    case 'linux-x64':
      return `Alpha-${version}-x86_64.AppImage`
    case 'linux-arm64':
      return `Alpha-${version}-aarch64.AppImage`
    default:
      throw new Error(`tauri targets: unsupported target ${target}`)
  }
}

/**
 * Resolve the artifact file extension of one bundle kind.
 * @param bundle - Bundle name accepted by `tauri build --bundles`.
 * @returns The artifact file extension, including the leading dot.
 */
export function tauriArtifactExtension(bundle: 'dmg' | 'nsis' | 'appimage'): string {
  switch (bundle) {
    case 'dmg':
      return '.dmg'
    case 'nsis':
      return '.exe'
    case 'appimage':
      return '.AppImage'
  }
}

/**
 * Resolve the output directory that holds one bundle kind.
 * @param bundle - Bundle name accepted by `tauri build --bundles`.
 * @returns The directory under `target/<triple>/release/bundle` containing the artifact.
 */
export function tauriBundleDirectory(bundle: 'dmg' | 'nsis' | 'appimage'): string {
  switch (bundle) {
    case 'dmg':
      return 'macos'
    case 'nsis':
      return 'nsis'
    case 'appimage':
      return 'appimage'
  }
}
