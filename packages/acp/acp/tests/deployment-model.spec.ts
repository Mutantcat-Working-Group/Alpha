import { afterEach, describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { makeBridgeHarness, textResponse, type BridgeHarness } from './harness.ts'

describe('ACP deployment model resolution', () => {
  let harness: BridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  it('falls back to the saved default when the deployment configures no route', async () => {
    harness = await makeBridgeHarness({
      script: [textResponse('ok')],
      config: { provider: undefined, model: undefined },
      defaultModel: { provider: 'mock', model: 'plain' },
      persona: 'model: {{model}}',
    })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })

    expect(created.configOptions).toMatchObject([
      { id: 'model', type: 'select', currentValue: '["mock","plain"]' },
    ])
    await harness.client.prompt({ sessionId: created.sessionId, prompt: [{ type: 'text', text: 'hi' }] })

    const request = harness.adapter.requests[0]
    expect(request?.provider).toBe('mock')
    expect(request?.model).toBe('plain')
    const system = request?.messages.find(message => message.role === 'system')
    expect(JSON.stringify(system?.content)).toContain('model: plain')
  })

  it('starts sessions unselected when no deployment and no default name a route', async () => {
    harness = await makeBridgeHarness({ config: { provider: undefined, model: undefined } })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })

    expect(created.configOptions).toEqual([])
    await expect(harness.client.prompt({
      sessionId: created.sessionId,
      prompt: [{ type: 'text', text: 'hi' }],
    })).rejects.toThrow(/has no provider\/model/)

    expect(harness.adapter.requests).toEqual([])
  })
})
