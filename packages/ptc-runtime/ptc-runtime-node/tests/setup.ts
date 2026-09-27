import { Context } from '@mutantcat/cordis'
import { onTestFinished } from 'vitest'
import SessionStore from '@mutantcat/dsh-session'
import FileSystem from '@mutantcat/dsh-fs-local'
import Subprocess from '@mutantcat/dsh-subprocess-local'
import Sandbox from '@mutantcat/dsh-sandbox-local'
import SandboxPolicy from '@mutantcat/dsh-sandbox-policy'
import SessionProjections from '@mutantcat/dsh-session-projection'
import type { SandboxMode } from '@mutantcat/dsh-sandbox'
import NodeRuntime from '../src/index.ts'
import type { Config } from '../src/index.ts'

export async function mountRuntime(ctx: Context, config: Config = {}, policy: { mode?: SandboxMode; workspaceRoot?: string } = {}) {
  onTestFinished(async () => { await ctx.fiber.dispose() })
  if (!ctx.get('sessions')) await ctx.plugin(SessionStore)
  if (!ctx.get('fs')) await ctx.plugin(FileSystem)
  if (!ctx.get('subprocess')) await ctx.plugin(Subprocess)
  if (!ctx.get('sandbox')) await ctx.plugin(Sandbox, {})
  if (!ctx.get('sessionProjections')) await ctx.plugin(SessionProjections)
  if (!ctx.get('sandboxPolicy')) await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', ...policy })
  await ctx.plugin(NodeRuntime, config)
  return ctx.ptcRuntime as NodeRuntime
}
