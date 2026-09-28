/** Node runtime environment for bundled package-manager and smoke launches. */

import { delimiter } from 'node:path'

/**
 * Resolve the environment for package scripts run by the bundled Node runtime.
 * @param bin - Directory containing the node shell launcher.
 * @param environment - Caller environment preserved for plugin execution.
 * @returns Environment with the launcher directory on PATH when one is supplied.
 */
export function desktopNodeEnvironment(bin: string | undefined, environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...environment,
    ...(bin === undefined ? {} : { PATH: `${bin}${delimiter}${environment.PATH ?? ''}` }),
  }
}
