/** Reverse-DNS identifier carried by every packaged platform. */
export const CI_APP_ID: 'org.mutantcat.alpha'

/** Ad-hoc codesign qualifier, used when no keychain identity exists. */
export const AD_HOC_IDENTITY: '-'

/** Platform and architecture selectors accepted by electron-builder. */
export type CiBuilderPlatform = 'darwin' | 'win32' | 'linux'
export type CiBuilderArch = 'arm64' | 'x64'

/** Resource or glob entry copied into the packaged application. */
export interface CiBuilderFileEntry {
  readonly from?: string
  readonly to?: string
  readonly filter?: readonly string[]
}

/** macOS disk image options used by the credential-free release build. */
export interface CiBuilderMacOptions {
  readonly icon: string
  readonly category: string
  readonly identity: string
  readonly forceCodeSigning: boolean
  readonly hardenedRuntime: boolean
  readonly notarize: boolean
  readonly target: readonly string[]
}

/** Windows installer options used by the credential-free release build. */
export interface CiBuilderWinOptions {
  readonly icon: string
  readonly forceCodeSigning: boolean
  readonly target: readonly string[]
  readonly signtoolOptions?: undefined
}

/** Linux package options used by the credential-free release build. */
export interface CiBuilderLinuxOptions {
  readonly category: string
  readonly target: readonly string[]
}

/** NSIS installer options shared by the installer and uninstaller UI. */
export interface CiBuilderNsisOptions {
  readonly installerSidebar: string
  readonly uninstallerSidebar: string
  readonly include: string
  readonly oneClick: boolean
  readonly perMachine: boolean
  readonly allowElevation: boolean
  readonly allowToChangeInstallationDirectory: boolean
  readonly installerLanguages: readonly string[]
  readonly differentialPackage: boolean
}

/** Artifact reported by electron-builder after one target finishes. */
export interface CiBuilderArtifact {
  readonly file: string
}

/** Packager context handed to electron-builder lifecycle hooks. */
export interface CiBuilderContext {
  readonly packager: {
    readonly appInfo: {
      readonly version: string
    }
  }
}

/** electron-builder configuration for one credential-free release target. */
export interface CiBuilderConfiguration {
  readonly appId: string
  readonly productName: string
  readonly artifactName: string
  readonly directories: { readonly output: string }
  readonly asar: boolean
  readonly electronDist: string
  readonly electronFuses: { readonly runAsNode: boolean }
  readonly beforeBuild: () => Promise<boolean>
  readonly files: readonly (string | CiBuilderFileEntry)[]
  readonly asarUnpack: readonly string[]
  readonly extraResources: readonly CiBuilderFileEntry[]
  readonly mac: CiBuilderMacOptions
  readonly dmg: { readonly sign: boolean; readonly writeUpdateInfo: boolean }
  readonly afterPack: (context: CiBuilderContext) => Promise<void>
  readonly artifactBuildCompleted: (artifact: CiBuilderArtifact) => Promise<void> | undefined
  readonly win: CiBuilderWinOptions
  readonly linux: CiBuilderLinuxOptions
  readonly nsis: CiBuilderNsisOptions
  readonly detectUpdateChannel: boolean
  readonly publish: null
  readonly extraMetadata?: undefined
}

/**
 * Create electron-builder configuration for one ad-hoc release target.
 * @param env - Packaging environment.
 * @param hostPlatform - Build-host platform used when no explicit target is present.
 * @param hostArch - Build-host architecture used when no explicit target is present.
 * @returns electron-builder configuration.
 */
export function createCiBuilderConfig(
  env?: NodeJS.ProcessEnv,
  hostPlatform?: NodeJS.Platform,
  hostArch?: string,
): CiBuilderConfiguration

/** Configuration for the host platform and architecture. */
declare const configuration: CiBuilderConfiguration
export default configuration
