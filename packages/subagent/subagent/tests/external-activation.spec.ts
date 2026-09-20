/** External execution ownership, result delivery, and process cleanup. */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '../src/index.ts'
import { TestSessionQuery } from './test-session-query.ts'
import type { SubagentStartRequest, SubagentCapabilities, SubagentResult, SubagentRun } from '../src/types.ts'
import { externalTestParent } from './external-activation-helpers.ts'
import { continuationManager } from './continuation-internals.ts'

const capabilities: SubagentCapabilities = {
  agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false,
}

async function setup(start: (request: SubagentStartRequest) => Promise<SubagentRun>) {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SubagentRuntime)
  const parent = await externalTestParent(ctx)
  await ctx.plugin(TestSessionQuery)
  ctx.subagents.registerProvider({ name: 'external', capabilities, inheritsParentContext: false, start })
  const controller = new AbortController()
  return {
    ctx, parent, controller,
    start: (delivery: 'parent' | 'caller' = 'caller') => ctx.subagents.startActivation({
      provider: 'external', label: 'External work', signal: controller.signal, delivery,
      request: { parent, prompt: [{ type: 'text', text: 'Work independently' }] },
    }),
    records: () => ctx.sessionProjections.snapshot(parent.session, ['subagentCatalog']).values.subagentCatalog,
  }
}

function execution() {
  const result = Promise.withResolvers<SubagentResult>()
  const cleanup = Promise.withResolvers<undefined>()
  const cleaning = Promise.withResolvers<undefined>()
  const dispose = vi.fn(() => { cleaning.resolve(undefined); return cleanup.promise })
  const run: SubagentRun = { id: SessionId('external-task'), result: result.promise, dispose }
  return { result, cleanup, cleaning, dispose, run }
}

const completed: SubagentResult = {
  output: [{ type: 'text', text: 'Reviewed three files.' }],
  structured: { files: 3 },
  stopReason: 'completed',
}

describe('external subagent activations', () => {
  it('keeps startup cancellation attached until unpublished resources finish cleanup', async () => {
    const entered = Promise.withResolvers<AbortSignal>()
    const cancelled = Promise.withResolvers<undefined>()
    const cleanup = Promise.withResolvers<undefined>()
    const fixture = await setup(async ({ signal }) => {
      entered.resolve(signal)
      signal.addEventListener('abort', () => { cancelled.resolve(undefined) }, { once: true })
      await cancelled.promise
      await cleanup.promise
      signal.throwIfAborted()
      throw new Error('cancelled startup unexpectedly continued')
    })
    const starting = fixture.start()
    const rejected = expect(starting).rejects.toThrow('cancel startup')
    const providerSignal = await entered.promise
    let settled = false
    void starting.then(() => { settled = true }, () => { settled = true })
    fixture.controller.abort(new Error('cancel startup'))
    await cancelled.promise
    expect(providerSignal.aborted).toBe(true)
    expect(settled).toBe(false)
    expect(fixture.records()).toEqual([])
    cleanup.resolve(undefined)
    await rejected
    expect(fixture.parent.inbox.nextTurn).toEqual([])
  })

  it.each(['drain', 'parent-detach', 'parent-replace'] as const)(
    'rechecks publication authority after a start listener triggers %s',
    async (change) => {
      const backend = execution()
      backend.cleanup.resolve(undefined)
      const fixture = await setup(async ({ signal }) => {
        signal.addEventListener('abort', () => { backend.result.resolve({ output: [], stopReason: 'aborted' }) }, { once: true })
        return backend.run
      })
      const session = fixture.ctx.sessions.create(SessionId('publication-parent'))
      const parent = { ...fixture.parent, id: session.id, session }
      const detachParent = fixture.ctx.agents.enter(parent, undefined)
      let detachReplacement: (() => void) | undefined
      let drain = Promise.resolve()
      fixture.ctx.on('subagent/start', () => {
        if (change === 'drain') {
          drain = continuationManager(fixture.ctx).drain()
        } else {
          detachParent()
          if (change === 'parent-replace') {
            detachReplacement = fixture.ctx.agents.enter({ ...parent }, undefined)
          }
        }
      })
      try {
        await expect(fixture.ctx.subagents.startActivation({
          provider: 'external', label: 'Unpublished work', signal: fixture.controller.signal, delivery: 'parent',
          request: { parent, prompt: [{ type: 'text', text: 'Must not publish' }] },
        })).rejects.toMatchObject({ code: change === 'drain' ? 'DRAINING' : 'UNAUTHORIZED' })
        await drain
        expect(backend.dispose).toHaveBeenCalledTimes(1)
        expect(fixture.ctx.sessionProjections.snapshot(session, ['subagentCatalog']).values.subagentCatalog).toEqual([])
        expect(parent.inbox.nextTurn).toEqual([])
      } finally {
        detachReplacement?.()
        detachParent()
      }
    },
  )

  it('detaches accepted work from caller cancellation and exposes its result before cleanup finishes', async () => {
    const backend = execution()
    let providerSignal: AbortSignal | undefined
    const fixture = await setup(async ({ signal }) => { providerSignal = signal; return backend.run })
    const activation = await fixture.start()
    fixture.controller.abort(new Error('caller stopped waiting'))
    expect(providerSignal?.aborted).toBe(false)
    expect(backend.dispose).not.toHaveBeenCalled()
    expect(fixture.ctx.sessions.get(activation.childId)).toBeUndefined()
    backend.result.resolve(completed)
    await expect(activation.result).resolves.toEqual(completed)
    await backend.cleaning.promise
    const disposal = activation.dispose()
    expect(activation.dispose()).toBe(disposal)
    let cleaned = false
    void disposal.then(() => { cleaned = true })
    await Promise.resolve()
    expect(cleaned).toBe(false)
    expect(backend.dispose).toHaveBeenCalledTimes(1)
    backend.cleanup.resolve(undefined)
    await disposal
    await activation.dispose()
    expect(backend.dispose).toHaveBeenCalledTimes(1)
    expect(fixture.records()).toMatchObject([{ id: activation.childId, external: true }])
    expect(fixture.parent.inbox.nextTurn).toEqual([])
  })

  it('cancels the external process once when the receipt is repeatedly disposed', async () => {
    const backend = execution()
    const cancelled = vi.fn(() => { backend.result.resolve({ output: [], stopReason: 'aborted' }) })
    const fixture = await setup(async ({ signal }) => {
      signal.addEventListener('abort', cancelled, { once: true })
      return backend.run
    })
    const activation = await fixture.start()
    const disposal = activation.dispose()
    expect(activation.dispose()).toBe(disposal)
    await backend.cleaning.promise
    expect(cancelled).toHaveBeenCalledTimes(1)
    expect(backend.dispose).toHaveBeenCalledTimes(1)
    backend.cleanup.resolve(undefined)
    await disposal
    await expect(activation.result).resolves.toEqual({ output: [], stopReason: 'aborted' })
    await activation.dispose()
    expect(cancelled).toHaveBeenCalledTimes(1)
  })

  it('can cancel a backend whose result settles only when disposal begins', async () => {
    const result = Promise.withResolvers<SubagentResult>()
    const dispose = vi.fn(async () => { result.resolve({ output: [], stopReason: 'aborted' }) })
    const fixture = await setup(async () => ({
      id: SessionId('dispose-settled'), result: result.promise, dispose,
    }))
    const activation = await fixture.start()
    await activation.dispose()
    await expect(activation.result).resolves.toEqual({ output: [], stopReason: 'aborted' })
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it.each(['parent', 'caller'] as const)('delivers the full failed result with %s delivery', async (delivery) => {
    const backend = execution()
    backend.cleanup.resolve(undefined)
    const fixture = await setup(async () => backend.run)
    const activation = await fixture.start(delivery)
    const failed: SubagentResult = { ...completed, stopReason: 'error', diagnostic: 'External transport failed.' }
    backend.result.resolve(failed)
    await expect(activation.result).resolves.toEqual(failed)
    await activation.dispose()
    expect(fixture.records()).toMatchObject([{ id: activation.childId, external: true }])
    if (delivery === 'caller') {
      expect(fixture.parent.inbox.nextTurn).toEqual([])
    } else {
      expect(fixture.parent.inbox.nextTurn).toHaveLength(1)
      const notice = fixture.parent.inbox.nextTurn[0]!
      expect(notice.source).toMatchObject({ kind: 'subagent-settled', senderSessionId: activation.childId })
      const text = notice.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
      expect(text).toContain('Reviewed three files.')
      expect(text).toContain('Structured result: {"files":3}')
      expect(text).toContain('External transport failed.')
      expect(text).not.toContain('follow-up')
    }
  })

  it('reports cleanup failure separately from a completed result without exposing the private cause', async () => {
    const backend = execution()
    const fixture = await setup(async () => backend.run)
    const activation = await fixture.start()
    backend.result.resolve(completed)
    await expect(activation.result).resolves.toEqual(completed)
    await backend.cleaning.promise
    const disposal = activation.dispose()
    const rejection = expect(disposal).rejects.toThrow('safe cleanup failure')
    backend.cleanup.reject(new Error('safe cleanup failure', { cause: new Error('/private/path SECRET_TOKEN') }))
    await rejection
    const error = await disposal.catch((error: unknown) => error)
    expect((error as Error).message).not.toContain('SECRET_TOKEN')
    expect((error as Error).message).not.toContain('/private/path')
    await expect(activation.result).resolves.toEqual(completed)
    expect(activation.dispose()).toBe(disposal)
    expect(fixture.records()).toMatchObject([{
      id: activation.childId, external: true,
    }])
  })
})


it('records external membership at creation without publishing settlement updates', async () => {
  const backend = execution()
  const fixture = await setup(async () => backend.run)
  const snapshots: unknown[] = []
  fixture.ctx.sessionProjections.snapshot(fixture.parent.session)
  const unsubscribe = fixture.ctx.sessionProjections.onChanged(() => { snapshots.push(fixture.records()) })
  try {
    const activation = await fixture.start()
    const expected = { id: activation.childId, mode: 'one-shot', label: 'External work', external: true }
    expect(await fixture.ctx.subagents.listChildren(fixture.parent.id)).toMatchObject([expected])
    expect(await fixture.ctx.subagents.listDescendants(fixture.parent.id)).toEqual([])
    expect(fixture.ctx.sessions.get(activation.childId)).toBeUndefined()
    const result: SubagentResult = { output: [{ type: 'text', text: 'x'.repeat(100_000) }], stopReason: 'completed' }
    backend.result.resolve(result)
    backend.cleanup.resolve(undefined)
    await expect(activation.result).resolves.toEqual(result)
    await activation.dispose()
    expect(await fixture.ctx.subagents.listChildren(fixture.parent.id)).toMatchObject([expected])
    expect(snapshots).toHaveLength(1)
    expect(JSON.stringify(snapshots).length).toBeLessThan(1_000)
  } finally {
    unsubscribe()
  }
})


it('refuses a reserved Session id for an external provider before dispatch', async () => {
  const start = vi.fn()
  const fixture = await setup(start)
  await expect(fixture.ctx.subagents.startActivation({
    provider: 'external', childId: SessionId('reserved'), label: 'External', delivery: 'parent',
    signal: fixture.controller.signal, request: { parent: fixture.parent, prompt: [] },
  })).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
  expect(start).not.toHaveBeenCalled()
})

it.each(['completed', 'aborted'] as const)('reports external %s without offering another turn', async (stopReason) => {
  const backend = execution()
  const fixture = await setup(async () => backend.run)
  const activation = await fixture.start('parent')
  backend.result.resolve({ output: [], stopReason })
  backend.cleanup.resolve(undefined)
  await activation.dispose()
  expect(JSON.stringify(fixture.parent.inbox.nextTurn)).toContain(stopReason === 'completed' ? 'cannot receive follow-up messages' : 'was stopped before it finished')
  expect(JSON.stringify(fixture.parent.inbox.nextTurn)).not.toContain('send it more')
})
