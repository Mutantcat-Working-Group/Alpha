/**
 * `SessionCommandController.pause()`/`resume()` drive one live ordinary Agent
 * between the running and paused states: pause requires a running turn, resume
 * requires a paused turn, both reject absent and subagent-owned Sessions.
 * @module dsh-api-session-controller/tests/commands-pause-resume
 */

import { Context } from '@mutantcat/cordis'
import AgentRegistry from '@mutantcat/dsh-agent'
import type { Agent, AgentStatus } from '@mutantcat/dsh-agent'
import SessionStore, { SessionId } from '@mutantcat/dsh-session'
import { snapshotSubagentDescriptor } from '@mutantcat/dsh-subagent'
import { subagentIdentityProjectionDefinition } from '@mutantcat/dsh-subagent/src/projection.ts'
import { describe, expect, it, vi } from 'vitest'
import { ApiSessionAgentController } from '../src/agent.ts'
import { SessionCommandController } from '../src/commands.ts'
import { installSessionReadTestServices } from './test-remote.ts'

interface Harness {
  ctx: Context
  controller: SessionCommandController
  agent: Agent
  setStatus: (status: AgentStatus) => void
  pause: ReturnType<typeof vi.fn>
  resume: ReturnType<typeof vi.fn>
}

async function harness(subagent = false): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  installSessionReadTestServices(ctx)
  ctx.sessionProjections.register(subagentIdentityProjectionDefinition)
  const sessionId = SessionId('pause-resume-session')
  const session = ctx.sessions.create(sessionId, {
    meta: subagent
      ? { cwd: '/workspace', origin: 'subagent' as const, parentSession: SessionId('offline-parent') }
      : { cwd: '/workspace' },
  })
  if (subagent) {
    session.append('subagent/descriptor', snapshotSubagentDescriptor({
      mode: 'continuable', provider: 'test', label: 'child',
    }))
  }
  const pause = vi.fn()
  const resume = vi.fn()
  const agent = {
    id: session.id,
    session,
    status: 'running',
    ctx,
    pause,
    resume,
  } as unknown as Agent
  await ctx.agents.register(agent)
  const agents = {
    selectionFor: () => ({ current: undefined, assembled: undefined }),
  } as unknown as ApiSessionAgentController
  return {
    ctx,
    controller: new SessionCommandController(ctx, agents, '/workspace'),
    agent,
    setStatus: (status) => { (agent as { status: AgentStatus }).status = status },
    pause,
    resume,
  }
}

async function expectFailure(operation: Promise<unknown>, code: string): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code })
}

describe('SessionCommandController.pause()', () => {
  it('parks a running ordinary Agent turn', async () => {
    const { controller, agent, pause } = await harness()
    expect(controller.pause({ sessionId: agent.id })).toEqual({ accepted: true })
    expect(pause).toHaveBeenCalledTimes(1)
  })

  it('rejects pausing a turn that is not running', async () => {
    const { controller, agent, pause, setStatus } = await harness()
    setStatus('idle')
    await expectFailure(
      Promise.resolve().then(() => controller.pause({ sessionId: agent.id })),
      'session/not-running',
    )
    expect(pause).not.toHaveBeenCalled()
  })

  it('rejects pausing an already-paused turn', async () => {
    const { controller, agent, setStatus } = await harness()
    setStatus('paused')
    await expectFailure(
      Promise.resolve().then(() => controller.pause({ sessionId: agent.id })),
      'session/not-running',
    )
  })

  it('rejects a Session with no live Agent', async () => {
    const { controller } = await harness()
    await expectFailure(
      Promise.resolve().then(() => controller.pause({ sessionId: SessionId('missing') })),
      'session/not-found',
    )
  })

  it('rejects a subagent-owned Session', async () => {
    const { controller, agent } = await harness(true)
    await expectFailure(
      Promise.resolve().then(() => controller.pause({ sessionId: agent.id })),
      'session/agent-busy',
    )
  })
})

describe('SessionCommandController.resume()', () => {
  it('continues a paused ordinary Agent turn', async () => {
    const { controller, agent, resume, setStatus } = await harness()
    setStatus('paused')
    expect(controller.resume({ sessionId: agent.id })).toEqual({ accepted: true })
    expect(resume).toHaveBeenCalledTimes(1)
  })

  it('rejects resuming a turn that is not paused', async () => {
    const { controller, agent, resume, setStatus } = await harness()
    setStatus('running')
    await expectFailure(
      Promise.resolve().then(() => controller.resume({ sessionId: agent.id })),
      'session/not-paused',
    )
    expect(resume).not.toHaveBeenCalled()
  })

  it('rejects a Session with no live Agent', async () => {
    const { controller } = await harness()
    await expectFailure(
      Promise.resolve().then(() => controller.resume({ sessionId: SessionId('missing') })),
      'session/not-found',
    )
  })

  it('rejects a subagent-owned Session', async () => {
    const { controller, agent } = await harness(true)
    await expectFailure(
      Promise.resolve().then(() => controller.resume({ sessionId: agent.id })),
      'session/agent-busy',
    )
  })
})
