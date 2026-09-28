/** Build one ad-hoc Tauri release artifact for a GitHub release, without certificates or an update feed. */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { desktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { parseCiPackageInvocation, type CiPackageTarget } from './ci-package.ts'
import { prepareReleaseInputs, releaseTargetEnv, runPnpm } from './ci-release-inputs.ts'
import {
  tauriArtifactExtension,
  tauriBundleDirectory,
  tauriReleaseAssetName,
  tauriTargetBundle,
  tauriTargetTriple,
} from './tauri-targets.ts'

const APP_ROOT = resolve(import.meta.dirname, '..')
const SRC_TAURI = join(APP_ROOT, 'src-tauri')

/**
 * Read the staged product version that Tauri writes into every artifact name.
 * @returns The version declared in `src-tauri/tauri.conf.json`.
 */
function stagedVersion(): string {
  const config = JSON.parse(readFileSync(join(SRC_TAURI, 'tauri.conf.json'), 'utf8')) as { version?: unknown }
  if (typeof config.version !== 'string' || config.version === '') {
    throw new Error('tauri package: src-tauri/tauri.conf.json declares no version')
  }
  return config.version
}

/**
 * Locate the single installable artifact one bundle kind produced.
 * @param target - Validated release target.
 * @param triple - Rust target triple the bundle was built for.
 * @param bundle - Bundle kind requested from `tauri build`.
 * @returns The absolute artifact path inside the Tauri bundle directory.
 */
function bundleArtifact(target: CiPackageTarget, triple: string, bundle: 'dmg' | 'nsis' | 'appimage'): string {
  const directory = join(SRC_TAURI, 'target', triple, 'release', 'bundle', tauriBundleDirectory(bundle))
  const extension = tauriArtifactExtension(bundle)
  const matches = globSync(`*${extension}`, { cwd: directory })
  if (matches.length === 0) throw new Error(`tauri package: ${target.name} produced no ${extension} artifact in ${directory}`)
  if (matches.length > 1) throw new Error(`tauri package: ${target.name} produced ambiguous artifacts in ${directory}: ${matches.join(', ')}`)
  return join(directory, matches[0] ?? '')
}

/**
 * Apply an ad-hoc signature to a macOS disk image.
 * @param image - Absolute path of the built DMG.
 * @returns Nothing; throws when `codesign` rejects the image.
 */
function adHocSignImage(image: string): void {
  const signed = spawnSync('codesign', ['--force', '--sign', '-', image], { stdio: 'inherit' })
  if (signed.status !== 0) throw new Error(`tauri package: ad-hoc signing failed for ${image}`)
}

/**
 * Read the code-signing material the release workflow staged on the runner.
 * @returns SignTool path, certificate path and password exported by the workflow.
 */
function signingMaterial(): { signTool: string; certificate: string; password: string } {
  const signTool = process.env.SIGNTOOL_PATH
  const certificate = process.env.PFX_PATH
  const password = process.env.SIGN_PASSWORD
  if (!signTool || !certificate || !password) {
    throw new Error('tauri package: SIGNTOOL_PATH, PFX_PATH and SIGN_PASSWORD must be exported by the release workflow')
  }
  return { signTool, certificate, password }
}

/**
 * Sign one Windows executable with the release workflow's self-signed certificate.
 * @param file - Absolute path of the executable to sign.
 * @param description - Description the signature is recorded with.
 * @returns Nothing; throws when SignTool rejects the file.
 */
function selfSignWindowsFile(file: string, description: string): void {
  const { signTool, certificate, password } = signingMaterial()
  if (!existsSync(file)) throw new Error(`tauri package: missing signature target ${file}`)
  const signed = spawnSync(signTool, ['sign', '/fd', 'SHA256', '/f', certificate, '/p', password, '/d', description, file], { stdio: 'inherit' })
  if (signed.status !== 0) throw new Error(`tauri package: signing failed for ${file}`)
}

/**
 * Compile the release shell and sign every executable the bundle will pack.
 * Tauri embeds the frontend into the binary at compile time, so the binary is
 * built and signed before the bundle step runs; otherwise the installer would
 * ship an unsigned application inside a signed wrapper.
 * @param triple - Rust target triple the release binary is compiled for.
 * @param env - Process environment carrying the release configuration.
 * @returns Nothing; throws when the build or a signature is rejected.
 */
function prepareSignedWindowsRelease(triple: string, env: NodeJS.ProcessEnv): void {
  const compiled = spawnSync('cargo', ['build', '--release', '--locked', '--target', triple, '--manifest-path', 'Cargo.toml'], { cwd: SRC_TAURI, stdio: 'inherit', env })
  if (compiled.status !== 0) throw new Error(`tauri package: cargo build exited with ${String(compiled.status)}`)
  signStagedWindowsExecutables(triple)
}

/**
 * Sign the shell binary and the Node sidecar the bundler packs into the installer.
 * @param triple - Rust target triple the bundle is built for.
 * @returns Nothing; throws when SignTool rejects a payload executable.
 */
function signStagedWindowsExecutables(triple: string): void {
  selfSignWindowsFile(join(SRC_TAURI, 'target', triple, 'release', 'alpha-desktop.exe'), 'Alpha')
  selfSignWindowsFile(join(SRC_TAURI, 'bin', `node-${triple}.exe`), 'Alpha Node Runtime')
}

/**
 * Publish the built artifact and its digest sidecar under the release asset name.
 * @param target - Validated release target.
 * @param built - Absolute path of the artifact inside the bundle directory.
 * @returns The artifact and sidecar paths the upload step collects.
 */
function publishArtifact(target: CiPackageTarget, built: string): { artifact: string; digest: string } {
  const buildPaths = desktopTargetBuildPaths(target.name)
  const name = tauriReleaseAssetName(target.name, stagedVersion())
  rmSync(buildPaths.artifacts, { recursive: true, force: true })
  mkdirSync(buildPaths.artifacts, { recursive: true })
  const artifact = join(buildPaths.artifacts, name)
  copyFileSync(built, artifact)
  const sha256 = createHash('sha256').update(readFileSync(artifact)).digest('hex')
  const digest = `${artifact}.sha256`
  // The sidecar follows `shasum -a 256` output so `shasum -a 256 -c` verifies the named asset.
  writeFileSync(digest, `${sha256}  ${name}\n`)
  return { artifact, digest }
}

/**
 * Build one release artifact from source and report the files the upload step collects.
 * @param target - Validated release target.
 * @returns Resolves after the artifact directory holds the signed artifact and its digest.
 */
export async function packageTauriTarget(target: CiPackageTarget): Promise<void> {
  const targetEnv = releaseTargetEnv(target)
  await prepareReleaseInputs(target)
  await runPnpm(['run', 'prepare:tauri-runtime'], APP_ROOT, targetEnv)
  const triple = tauriTargetTriple(target.name)
  const bundle = tauriTargetBundle(target.name)
  // Hosted runners carry no signing identity. Disable discovery everywhere so the build
  // never stalls looking for a certificate, and sign macOS ad hoc through `codesign -s -`.
  // create-dmg detaches the image it mounted; in a GUI session Finder can hold that
  // volume, where the script's retries run out and the build fails. The PATH-prefixed
  // shim retries the detach with -force; hosted runners detach on the first attempt.
  const tauriEnv: NodeJS.ProcessEnv = {
    ...targetEnv,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    ...(target.platform === 'darwin' ? {
      APPLE_SIGNING_IDENTITY: '-',
      PATH: `${join(APP_ROOT, 'scripts', 'dmg-tools')}${delimiter}${targetEnv.PATH ?? ''}`,
    } : {}),
  }
  // The bundle step packs the compiled binary as it stands, and the frontend is
  // already staged by now, so build and sign the payload before it runs.
  if (target.platform === 'win32') prepareSignedWindowsRelease(triple, tauriEnv)
  await runPnpm(['exec', 'tauri', 'build', '--target', triple, '--bundles', bundle], APP_ROOT, tauriEnv)
  const built = bundleArtifact(target, triple, bundle)
  if (target.platform === 'darwin') adHocSignImage(built)
  if (target.platform === 'win32') selfSignWindowsFile(built, 'Alpha Installer')
  const { artifact, digest } = publishArtifact(target, built)
  process.stdout.write(`${artifact}\n${digest}\n`)
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  await packageTauriTarget(parseCiPackageInvocation(process.argv.slice(2)))
}
