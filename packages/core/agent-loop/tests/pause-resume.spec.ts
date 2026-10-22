/**
 * `Agent.pause()` parks a running turn between steps: the in-flight model step
 * is cut, its delivered prefix settles as an interrupted assistant message,
 * and the turn stays open. `Agent.resume()` continues the turn — the next step
 * reassembles its request from the log, so the model sees everything up to the
 * pause point and keeps going without re-sending the turn's input.
 * @module dsh-agent-loop/tests/pause-resume
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

/** Wait until the mock adapter has recorded at least `count` model requests. */
async function awaitRequests(adapter: MockAdapter, count: number): Promise<void> {
  while (adapter.requests.length < count) await new Promise(resolve => setTimeout(resolve, 5))
}

/** Wait until the session log contains at least `count` events of `type`. */
async function awaitEventCount(agent: Agent, type: string, count: number): Promise<void> {
  while (agent.session.snapshotEvents().filter(event => event.type === type).length < count) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

describe('Agent.pause() / resume()', () => {
  it('pauses and resumes are no-ops outside a running turn', async () => {
    const ctx = await harness(new MockAdapter([textResponse('unused')]))
    const agent = await ctx.agentLoop.create(SessionId('idle-pause'), { provider: 'mock', model: 'mock' })

    expect(agent.status).toBe('idle')
    agent.pause()
    agent.resume()
    expect(agent.status).toBe('idle')
  })

  it('parks the turn between steps and continues it from the pause point', async () => {
    const adapter = new MockAdapter(['hang', textResponse('continued reply')])
    const ctx = await harness(adapter)
    const statuses: string[] = []
    ctx.on('agent/status', ({ status }) => { statuses.push(status) })
    const agent = await ctx.agentLoop.create(SessionId('pause-resume'), { provider: 'mock', model: 'mock' })

    send(agent, 'first prompt')
    await awaitRequests(adapter, 1)
    await new Promise(resolve => setTimeout(resolve, 30))

    agent.pause()
    expect(agent.status).toBe('paused')

    // The cut step settles its delivered prefix as an interrupted message; the
    // turn stays open, so no turn/end is appended while parked.
    await awaitEventCount(agent, 'assistant/message', 1)
    const interrupted = agent.session.snapshotEvents().filter(event => event.type === 'assistant/message')
    expect(interrupted).toHaveLength(1)
    expect(interrupted[0]?.data).toMatchObject({ interrupted: true, message: { content: [{ type: 'text', text: 'partial' }] } })
    expect(agent.session.snapshotEvents().some(event => event.type === 'turn/end')).toBe(false)

    agent.resume()
    expect(agent.status).toBe('running')
    await agent.whenIdle()

    // The turn continued from the pause point: a second model call whose request
    // was reassembled from the log (the interrupted prefix included), then the
    // turn completed normally.
    expect(adapter.requests).toHaveLength(2)
    const end = agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')
    expect(end?.data.reason).toEqual({ kind: 'completed' })
    const messages = agent.session.snapshotEvents().filter(event => event.type === 'assistant/message')
    expect(messages).toHaveLength(2)
    expect(messages[1]?.data).toMatchObject({ message: { content: [{ type: 'text', text: 'continued reply' }] } })
    expect(statuses).toContain('paused')
    expect(statuses).toContain('running')
  })

  it('reassembles the resumed request from the log up to the pause point', async () => {
    const adapter = new MockAdapter(['hang', textResponse('after resume')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('pause-reassembly'), { provider: 'mock', model: 'mock' })

    send(agent, 'task to resume')
    await awaitRequests(adapter, 1)
    await new Promise(resolve => setTimeout(resolve, 30))

    agent.pause()
    await awaitEventCount(agent, 'assistant/message', 1)
    agent.resume()
    await agent.whenIdle()

    // The second request must carry the original user message and the
    // interrupted assistant prefix, proving the turn continued rather than
    // re-sending a duplicate turn.
    const secondRequest = adapter.requests[1]
    const roles = (secondRequest?.messages ?? []).map(message => message.role)
    expect(roles).toContain('user')
    expect(roles).toContain('assistant')
    const assistantText = (secondRequest?.messages ?? [])
      .filter(message => message.role === 'assistant')
      .map(message => JSON.stringify(message.content))
      .join('')
    expect(assistantText).toContain('partial')
  })

  it('delivers input queued while parked when the turn resumes', async () => {
    const adapter = new MockAdapter(['hang', textResponse('done')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('pause-queued'), { provider: 'mock', model: 'mock' })

    send(agent, 'first')
    await awaitRequests(adapter, 1)
    await new Promise(resolve => setTimeout(resolve, 30))

    agent.pause()
    await awaitEventCount(agent, 'assistant/message', 1)
    // Queue follow-up input while the turn is parked.
    send(agent, 'queued while paused')

    agent.resume()
    await agent.whenIdle()

    const userMessages = agent.session.snapshotEvents().filter(event => event.type === 'user/message')
    expect(userMessages).toHaveLength(2)
  })

  it('treats a second pause of a parked turn as a no-op', async () => {
    const adapter = new MockAdapter(['hang', textResponse('after')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('pause-twice'), { provider: 'mock', model: 'mock' })

    send(agent, 'prompt')
    await awaitRequests(adapter, 1)
    await new Promise(resolve => setTimeout(resolve, 30))

    agent.pause()
    await awaitEventCount(agent, 'assistant/message', 1)
    agent.pause()
    expect(agent.status).toBe('paused')

    agent.resume()
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(2)
  })

  it('cancelling a parked turn ends it aborted and returns to idle', async () => {
    const adapter = new MockAdapter(['hang', textResponse('unused')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('pause-cancel'), { provider: 'mock', model: 'mock' })

    send(agent, 'prompt')
    await awaitRequests(adapter, 1)
    await new Promise(resolve => setTimeout(resolve, 30))

    agent.pause()
    await awaitEventCount(agent, 'assistant/message', 1)

    agent.cancel({ kind: 'user' })
    await agent.whenIdle()

    const end = agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')
    expect(end?.data.reason).toEqual({ kind: 'aborted', reason: { kind: 'user' } })
    expect(agent.status).toBe('idle')
  })
})
