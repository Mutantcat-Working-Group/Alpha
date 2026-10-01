import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Context } from '@mutantcat/cordis'
import { describe, expect, it } from 'vitest'
import SkillRegistry from '@mutantcat/dsh-skill'
import * as SkillBadge from '@mutantcat/dsh-skill-badge'

describe('dsh-skill-badge', () => {
  it('registers and disposes the bundled badge skill', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const fiber = await ctx.plugin(SkillBadge)
    const resourcePath = fileURLToPath(new URL('../assets/', import.meta.url))

    expect(await ctx.skills.list()).toEqual([{
      name: 'alpha-badge',
      description: 'Add the “powered by Alpha” badge to documents, pull requests, merge requests, and other content produced with Alpha. Use whenever creating a pull request or merge request. Also use when the user asks for an Alpha badge, powered-by-Alpha attribution, or a reusable Alpha badge asset or snippet.',
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'alpha-badge',
      source: 'bundled',
      resourceBase: { kind: 'directory', path: resourcePath },
    }])
    const loaded = await ctx.skills.get('alpha-badge')
    expect(loaded?.content).toContain('Preserve the badge\'s 121×20 dimensions')
    expect(loaded?.resourceBase).toEqual({ kind: 'directory', path: resourcePath })

    await fiber.dispose()
    expect(await ctx.skills.list()).toEqual([])
  })

  it('ships the official 726×120 PNG unchanged', async () => {
    const image = await readFile(new URL('../assets/alpha-badge.png', import.meta.url))
    expect(image.readUInt32BE(16)).toBe(726)
    expect(image.readUInt32BE(20)).toBe(120)
    expect(createHash('sha256').update(image).digest('hex')).toBe(
      '95d9b47415caf51c18c39c241570aeac33fd66946d65554ed5a3059e424f7354',
    )
  })
})
