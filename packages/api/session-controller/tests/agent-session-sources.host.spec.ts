/**
 * Discovery of the Agent session stores installed on the machine the Host runs
 * on. Every case stubs a throwaway home directory as the user's home, because
 * a real `~/.codex` or `~/.claude` on the host would otherwise leak an Agent
 * into the expected list.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@mutantcat/cordis'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listAgentSessionSources } from '../src/agent-session-sources.ts'
import { HarnessSessionImport } from '../src/import-harness-sessions.ts'

const homes: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})

/**
 * One throwaway home directory this spec owns, stubbed as the user's home.
 * Windows `homedir()` reads `USERPROFILE` rather than `HOME`, so both names are
 * stubbed and the real home never contributes an installed Agent.
 * @returns the absolute path of the stubbed home directory.
 */
async function home(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-agent-sources-home-'))
  homes.push(root)
  vi.stubEnv('HOME', root)
  if (process.platform === 'win32') vi.stubEnv('USERPROFILE', root)
  return root
}

describe('Agent session source discovery', () => {
  it('leads with the Alpha store when the configured root exists and omits it when it does not', async () => {
    const root = await home()
    const own = join(root, 'sessions')
    await mkdir(own, { recursive: true })

    await expect(listAgentSessionSources(own)).resolves.toEqual({
      sources: [{ agent: 'dsh', sourceRoot: own }],
    })
    await expect(listAgentSessionSources(join(root, 'absent'))).resolves.toEqual({ sources: [] })
  })

  it('lists every installed foreign Agent with its own sessions root', async () => {
    const root = await home()
    await mkdir(join(root, '.codex', 'sessions'), { recursive: true })
    await mkdir(join(root, '.claude', 'projects'), { recursive: true })
    await mkdir(join(root, '.zcode', 'cli', 'db'), { recursive: true })
    await writeFile(join(root, '.zcode', 'cli', 'db', 'db.sqlite'), '')

    await expect(listAgentSessionSources(join(root, 'absent'))).resolves.toEqual({
      sources: [
        { agent: 'codex', sourceRoot: join(root, '.codex') },
        { agent: 'claude', sourceRoot: join(root, '.claude') },
        { agent: 'zcode', sourceRoot: join(root, '.zcode') },
      ],
    })
  })

  it('counts ZCode as installed on either marker and not on its home directory alone', async () => {
    const root = await home()
    await mkdir(join(root, '.zcode', 'v2', 'sessions'), { recursive: true })
    await mkdir(join(root, '.codex'), { recursive: true })

    await expect(listAgentSessionSources(join(root, 'absent'))).resolves.toEqual({
      sources: [{ agent: 'zcode', sourceRoot: join(root, '.zcode') }],
    })
  })

  it('reports the installed sources through the import operation', async () => {
    const root = await home()
    const own = join(root, 'sessions')
    await mkdir(own, { recursive: true })
    const operation = new HarnessSessionImport(new Context(), own)

    await expect(operation.listSources()).resolves.toEqual({
      sources: [{ agent: 'dsh', sourceRoot: own }],
    })
  })
})
