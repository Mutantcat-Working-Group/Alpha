/** Build one ad-hoc Tauri release artifact for a GitHub release, without certificates or an update feed. */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  await runPnpm(['exec', 'tauri', 'build', '--target', triple, '--bundles', bundle], APP_ROOT, tauriEnv)
  const built = bundleArtifact(target, triple, bundle)
  if (target.platform === 'darwin') adHocSignImage(built)
  const { artifact, digest } = publishArtifact(target, built)
  process.stdout.write(`${artifact}\n${digest}\n`)
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  await packageTauriTarget(parseCiPackageInvocation(process.argv.slice(2)))
}
