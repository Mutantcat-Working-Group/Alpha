/**
 * `Agent.interruptModelStep()` cuts only the in-flight provider wait: the turn
 * keeps going and admits the next step, which is how a mid-turn model switch
 * applies without cancelling the turn.
 * @module dsh-agent-loop/tests/model-step-interrupt
 */

import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@mutantcat/dsh-llm'
import { Context } from '@mutantcat/cordis'
import LlmRuntime from '@mutantcat/dsh-llm'
import SessionStore, { SessionId } from '@mutantcat/dsh-session'
import SystemPrompt from '@mutantcat/dsh-system-prompt'
import ToolRuntime from '@mutantcat/dsh-tools'
import AgentRegistry, { type Agent } from '@mutantcat/dsh-agent'
import AgentLoop from '@mutantcat/dsh-agent-loop'
import SessionProjectionRegistry from '@mutantcat/dsh-session-projection'
import { MockAdapter, textResponse } from './mock-adapter.ts'

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

describe('Agent.interruptModelStep()', () => {
  it('reports nothing to cut while the agent is idle', async () => {
    const ctx = await harness(new MockAdapter([textResponse('unused')]))
    const agent = await ctx.agentLoop.create(SessionId('idle-interrupt'), { provider: 'mock', model: 'mock' })

    expect(agent.interruptModelStep()).toBe(false)
  })

  it('settles the delivered prefix and lets the turn admit the next step', async () => {
    const adapter = new MockAdapter(['hang', textResponse('second reply')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('step-interrupt'), { provider: 'mock', model: 'mock' })

    send(agent, 'first prompt')
    while (adapter.requests.length === 0) await new Promise(resolve => setTimeout(resolve, 5))
    await new Promise(resolve => setTimeout(resolve, 30))

    agent.inject(createUserMessage({ content: [{ type: 'text', text: 'switch model' }], source: { kind: 'user' } }))
    expect(agent.interruptModelStep()).toBe(true)
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(2)
    const messages = agent.session.snapshotEvents().filter(event => event.type === 'assistant/message')
    expect(messages).toHaveLength(2)
    expect(messages[0]?.data).toMatchObject({ interrupted: true })
    expect(messages[1]?.data).toMatchObject({ message: { content: [{ type: 'text', text: 'second reply' }] } })
    const end = agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')
    expect(end?.data.reason).toEqual({ kind: 'completed' })
  })

  it('ignores a second interrupt once the provider wait is already cut', async () => {
    const adapter = new MockAdapter(['hang', textResponse('after')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('double-interrupt'), { provider: 'mock', model: 'mock' })

    send(agent, 'prompt')
    while (adapter.requests.length === 0) await new Promise(resolve => setTimeout(resolve, 5))
    expect(agent.interruptModelStep()).toBe(true)
    expect(agent.interruptModelStep()).toBe(false)
    agent.cancel({ kind: 'user' })
    await agent.whenIdle()
  })
})
