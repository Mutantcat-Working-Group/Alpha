import type { MacOSSigningEnvironment } from './desktop-release-environment.mjs'

/**
 * Reject signature metadata that does not name the company release authority and team.
 * @param details - Output from `codesign --display --verbose=4`.
 * @param expected - Public release identity.
 */
export function assertMacOSSignatureDetails(details: string, expected: MacOSSigningEnvironment): void

/**
 * Require the signature properties Apple validates for executable runtime content.
 * @param details - Output from `codesign --display --verbose=4`.
 * @param expected - Public release identity.
 */
export function assertMacOSRuntimeSignatureDetails(details: string, expected: MacOSSigningEnvironment): void

/**
 * Sign one Mach-O file using the packaging-owned CSC_KEYCHAIN; missing setup rejects before signing.
 * @param path - Writable standalone Mach-O file.
 * @param identifier - Stable code-signing identifier derived from the release app ID and CAS digest.
 * @param expected - Public release identity.
 * @param entitlements - Optional entitlement plist for this executable.
 * @returns Resolves after codesign exits successfully.
 */
export function signMacOSRuntimeCode(
  path: string,
  identifier: string,
  expected: MacOSSigningEnvironment,
  entitlements?: string,
): Promise<void>

/**
 * Verify one Mach-O file embedded in the runtime tree.
 * @param path - Mach-O file to inspect.
 * @param expected - Public release identity.
 */
export function verifyMacOSRuntimeCode(path: string, expected: MacOSSigningEnvironment): void
