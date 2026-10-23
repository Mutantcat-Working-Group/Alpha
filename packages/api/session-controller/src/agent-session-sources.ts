/**
 * Discovery of the Agent session stores installed on the machine the Host runs on.
 *
 * The catalog below is fixed: each entry names one Agent, the sessions root the
 * import opens for it, and the paths whose presence marks that Agent as
 * installed. Nothing here opens a Session — the import re-detects the format of
 * whatever root the caller picked, so a root whose layout changed is refused by
 * the import rather than misread here.
 * @module @mutantcat/dsh-api-session-controller/agent-session-sources
 */

import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  SessionImportHarnessAgent,
  SessionImportHarnessAgentSource,
  SessionImportHarnessSourcesValue,
} from './types.ts'

/** One foreign Agent's fixed home-directory layout. */
interface ForeignAgentLayout {
  /** Agent identity, which also names the store's on-disk format. */
  readonly agent: SessionImportHarnessAgent
  /** Sessions root the import reads, relative to the user's home directory. */
  readonly sessionsRoot: readonly string[]
  /**
   * Paths whose presence marks the Agent as installed, relative to the user's
   * home directory. The Agent counts as installed when any of them exists.
   */
  readonly installedMarkers: readonly (readonly string[])[]
}

/**
 * Agents other than Alpha's own, with the home-directory layout each one
 * writes. Kept beside the format detection in `foreign-format-adapters.ts`,
 * which reads whatever root a caller names.
 */
const FOREIGN_AGENT_LAYOUTS: readonly ForeignAgentLayout[] = [
  {
    agent: 'codex',
    sessionsRoot: ['.codex'],
    installedMarkers: [['.codex', 'sessions']],
  },
  {
    agent: 'claude',
    sessionsRoot: ['.claude'],
    installedMarkers: [['.claude', 'projects']],
  },
  {
    agent: 'zcode',
    sessionsRoot: ['.zcode'],
    installedMarkers: [['.zcode', 'cli', 'db', 'db.sqlite'], ['.zcode', 'v2', 'sessions']],
  },
]

/** Whether one path exists, treating an unreadable parent as absence. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * List the Agent session stores installed under the user's home directory.
 *
 * Alpha's own store leads the list and reads the deployment-configured root, so
 * a configured root outside the default layout stays the one this import opens.
 * @param configuredRoot - configured root the `dsh` entry reads.
 * @returns one entry per installed Agent, with Alpha's own store first.
 */
export async function listAgentSessionSources(
  configuredRoot: string,
): Promise<SessionImportHarnessSourcesValue> {
  const home = homedir()
  const sources: SessionImportHarnessAgentSource[] = []
  if (await pathExists(configuredRoot)) {
    sources.push({ agent: 'dsh', sourceRoot: configuredRoot })
  }
  for (const layout of FOREIGN_AGENT_LAYOUTS) {
    const markers = await Promise.all(
      layout.installedMarkers.map(marker => pathExists(join(home, ...marker))),
    )
    if (!markers.some(Boolean)) continue
    sources.push({ agent: layout.agent, sourceRoot: join(home, ...layout.sessionsRoot) })
  }
  return { sources }
}
