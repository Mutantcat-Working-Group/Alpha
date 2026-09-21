/** electron-builder configuration for credential-free release artifacts. */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { desktopTargetBuildPaths, resolveDesktopBuildTarget } from './desktop-build-paths.mjs'
import { installWindowsDirectoryInstaller } from './windows-directory-installer.mjs'

const execFileAsync = promisify(execFile)

/** Reverse-DNS identifier carried by every packaged platform. */
export const CI_APP_ID = 'org.mutantcat.alpha'

/** codesign qualifier that selects an ad-hoc signature. */
const AD_HOC_IDENTITY = '-'

/**
 * Create electron-builder configuration for one ad-hoc release target.
 *
 * Release artifacts are built without certificates, an update feed, or a mandatory-update
 * policy: macOS carries an ad-hoc identity over the whole bundle, Windows skips Authenticode,
 * and every artifact is uploaded to the GitHub release by the caller. The official signed
 * release path keeps its own configuration.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @param {NodeJS.Platform} hostPlatform - Build-host platform used when no explicit target is present.
 * @param {string} hostArch - Build-host architecture used when no explicit target is present.
 * @returns {object} electron-builder configuration.
 */
export function createCiBuilderConfig(
  env = process.env,
  hostPlatform = process.platform,
  hostArch = process.arch,
) {
  const target = resolveDesktopBuildTarget(env, hostPlatform, hostArch)
  const resolvedPlatform = target.startsWith('mac-') ? 'darwin' : target.startsWith('win-') ? 'win32' : 'linux'
  const resolvedArch = target.endsWith('arm64') ? 'arm64' : 'x64'
  const packagesWindows = resolvedPlatform === 'win32'
  const packagesMacOS = resolvedPlatform === 'darwin'
  const buildPaths = desktopTargetBuildPaths(target)
  // The directory installer rewrites the pinned NSIS template before any target is built.
  if (packagesWindows) installWindowsDirectoryInstaller()
  return {
    appId: CI_APP_ID,
    productName: 'Alpha',
    artifactName: 'Alpha-${version}-${os}-${arch}.${ext}',
    directories: { output: buildPaths.artifacts },
    asar: true,
    electronDist: buildPaths.electron,
    electronFuses: { runAsNode: true },
    beforeBuild: async () => {
      if (!packagesWindows) return true
      await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        fileURLToPath(new URL('./prepare-windows-installer.ps1', import.meta.url)),
        '-OutputDirectory', join(buildPaths.root, 'installer-ui')], { windowsHide: true })
      // A falsy result tells electron-builder to omit its production node_modules collection.
      return true
    },
    files: [
      'lib/main.js',
      'lib/preload-app.cjs',
      'lib/preload-mandatory.cjs',
      'lib/preload-update-dialog.cjs',
      'renderer/**/*',
      'package.json',
      { from: buildPaths.dsh, to: 'dsh', filter: ['**/*'] },
      // electron-builder excludes a source directory's root node_modules.
      { from: join(buildPaths.dsh, 'node_modules'), to: 'dsh/node_modules', filter: ['**/*'] },
    ],
    asarUnpack: [
      '**/*.{node,dylib,dll,so,exe}',
      '**/*.so.*',
      '**/spawn-helper',
      '**/@vscode/ripgrep/bin/rg',
    ],
    extraResources: [
      { from: buildPaths.runtime, to: 'runtime' },
      { from: fileURLToPath(new URL('../resources/icon.png', import.meta.url)), to: 'icon.png' },
    ],
    mac: {
      icon: fileURLToPath(new URL('../resources/icon-macos.png', import.meta.url)),
      category: 'public.app-category.developer-tools',
      // An ad-hoc identity needs no keychain entry, so the runner stays credential-free.
      identity: AD_HOC_IDENTITY,
      forceCodeSigning: true,
      // Ad-hoc signing cannot carry the hardened runtime's library-validation exception.
      hardenedRuntime: false,
      notarize: false,
      target: ['dmg'],
    },
    // electron-builder silently skips DMG signing when the identity has no keychain entry,
    // so the ad-hoc signature is applied to the finished image instead.
    dmg: { sign: false, writeUpdateInfo: false },
    afterPack: async context => {
      const { verifyDesktopRuntime } = await import('../lib/types/runtime-tree.js')
      await verifyDesktopRuntime(buildPaths.dsh,
        context.packager.appInfo.version, { platform: resolvedPlatform, arch: resolvedArch })
    },
    artifactBuildCompleted: artifact => {
      if (!packagesMacOS || !artifact.file.endsWith('.dmg')) return
      return execFileAsync('codesign', ['--force', '--sign', AD_HOC_IDENTITY, artifact.file])
    },
    win: {
      icon: fileURLToPath(new URL('../resources/icon-windows.png', import.meta.url)),
      forceCodeSigning: false,
      target: ['nsis'],
    },
    linux: {
      category: 'Development',
      target: ['AppImage'],
    },
    nsis: {
      installerSidebar: join(buildPaths.root, 'installer-ui', 'uninstaller-sidebar.bmp'),
      uninstallerSidebar: join(buildPaths.root, 'installer-ui', 'uninstaller-sidebar.bmp'),
      include: fileURLToPath(new URL('./installer.nsh', import.meta.url)),
      oneClick: false,
      perMachine: false,
      allowElevation: false,
      allowToChangeInstallationDirectory: false,
      installerLanguages: ['en_US', 'zh_CN'],
      differentialPackage: false,
    },
    detectUpdateChannel: false,
    publish: null,
  }
}

export default createCiBuilderConfig()
