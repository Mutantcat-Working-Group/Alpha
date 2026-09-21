/** Explicit exceptions and Host packages for the published dependency policy. */

/** Packages treated as Client/Host packages without declaring `dsh.client`. */
const CLIENT_FACE_INCLUDE: readonly string[] = []

/** Packages exempted from automatic Client/Host treatment despite declaring `dsh.client`. */
const CLIENT_FACE_EXCLUDE: readonly string[] = [
  '@mutantcat/dsh-api-session-controller',
  '@mutantcat/dsh-api-workspace-controller',
]

/** Host-only packages whose peer relays are deliberately flattened. */
const HOST_DEPENDENCY_PACKAGES: readonly string[] = [
  '@mutantcat/dsh-llm',
  '@mutantcat/dsh-session',
]

/** Development-only package relationships not represented by source imports. */
const CONFIGURATION_ONLY_DEV_DEPENDENCIES = {
  '@mutantcat/dsh-client-locale': ['@mutantcat/dsh-api-remotes'],
  '@mutantcat/dsh-client-ui-conversation': [
    '@mutantcat/dsh-api-remotes',
    '@mutantcat/dsh-client-ui-workspace',
  ],
  '@mutantcat/dsh-client-ui-model-selection': ['@mutantcat/dsh-client-ui-input-trigger'],
  '@mutantcat/dsh-client-ui-sidebar': ['@mutantcat/dsh-client-ui-workspace'],
  '@mutantcat/dsh-client-ui-subagent': ['@mutantcat/dsh-client-ui-input-trigger'],
  '@mutantcat/dsh-client-ui-theme': ['@mutantcat/dsh-api-remotes'],
  '@mutantcat/dsh-client-ui-tool': ['@mutantcat/dsh-api-remotes'],
} as const satisfies Readonly<Record<string, readonly string[]>>

/** Workspace packages whose complete runtime surface is safe across duplicate installations. */
const DUPLICATE_SAFE_PACKAGES: readonly string[] = [
  '@mutantcat/dsh-brand',
  '@mutantcat/dsh-lazy-require',
  '@mutantcat/dsh-typert-protocol',
  '@mutantcat/dsh-util-crypto',
  '@mutantcat/dsh-util-values',
]

/**
 * Runtime exports whose values remain valid when npm installs another package copy.
 * New entries are forbidden by default. Automated agents must not add an
 * exception; every addition requires explicit human review and a dedicated,
 * prominent heading in the pull request description.
 */
const SAFE_HOST_DEPENDENCY_EXPORTS = {
  '@mutantcat/dsh-credentials': ['credentialKey'],
  '@mutantcat/dsh-deque': ['Deque'],
  '@mutantcat/dsh-llm': ['callConfigEquals'],
  '@mutantcat/dsh-session-format': ['sessionFormatLogFilename'],
  '@mutantcat/dsh-timeout': ['MAX_TIMER_DELAY_MS'],
  '@mutantcat/schemastery': ['default'],
} as const satisfies HostDependencyExports

/** Runtime exports that require every consumer to resolve the provider's shared peer instance. */
const PEER_REQUIRED_HOST_EXPORTS = {
  '@mutantcat/dsh-subprocess': ['SubprocessExecutableNotFoundError'],
  '@mutantcat/dsh-scope': ['carrierKeyOf', 'scopeOf', 'scopeTarget'],
  '@mutantcat/dsh-session': ['SESSION_FORMAT_VERSION'],
  '@mutantcat/dsh-session-persistence': ['SessionPersistenceNotFoundError'],
} as const satisfies HostDependencyExports

/** Exact import specifier to reviewed runtime exports. */
type HostDependencyExports = Readonly<Record<string, readonly string[]>>

/** Complete configurable input to package dependency classification. */
export interface PackageDependencyPolicy {
  readonly clientFaceInclude: readonly string[]
  readonly clientFaceExclude: readonly string[]
  readonly hostPackages: readonly string[]
  readonly configurationOnlyDevDependencies: Readonly<Record<string, readonly string[]>>
  readonly duplicateSafePackages?: readonly string[]
  readonly safeHostDependencyExports: HostDependencyExports
  readonly peerRequiredHostExports: HostDependencyExports
}

/** Repository dependency policy consumed by verification and benchmarking. */
export const PACKAGE_DEPENDENCY_POLICY: PackageDependencyPolicy = {
  clientFaceInclude: CLIENT_FACE_INCLUDE,
  clientFaceExclude: CLIENT_FACE_EXCLUDE,
  hostPackages: HOST_DEPENDENCY_PACKAGES,
  configurationOnlyDevDependencies: CONFIGURATION_ONLY_DEV_DEPENDENCIES,
  duplicateSafePackages: DUPLICATE_SAFE_PACKAGES,
  safeHostDependencyExports: SAFE_HOST_DEPENDENCY_EXPORTS,
  peerRequiredHostExports: PEER_REQUIRED_HOST_EXPORTS,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a package manifest declares a dynamically loaded Client entry. */
export function hasClientDeclaration(dshField: unknown): boolean {
  return isRecord(dshField) && Object.hasOwn(dshField, 'client')
}

/** Whether the repository policy flattens one package's non-Cordis peers. */
export function usesFlattenedPackageDependencies(
  manifestPath: string,
  packageName: string,
  dshField: unknown,
  policy: PackageDependencyPolicy = PACKAGE_DEPENDENCY_POLICY,
): boolean {
  if (!manifestPath.startsWith('packages/') || manifestPath.startsWith('packages/experimental/')) return false
  if (policy.hostPackages.includes(packageName)) return true
  if (manifestPath.startsWith('packages/client/')) return true
  const included = hasClientDeclaration(dshField) || policy.clientFaceInclude.includes(packageName)
  return included && !policy.clientFaceExclude.includes(packageName)
}
