// Web e2e scenario, Host half: a provider route the Models page writes must
// reach the Host llm registry and the browser model catalog. No browser and
// no model calls: the write is settings/llm-domain traffic, and the catalog
// read is what the composer model seat renders from. A route that never
// registers leaves the composer seat on the deployment default with nothing
// to switch to, which is what this scenario pins down.
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

const NS = 'llm-pi-ai'
const ROUTE = 'acme-gateway'
const MODEL = 'acme-large'

describe('web e2e: a route the Models page writes reaches the composer catalog', () => {
  let scaffold: WebScaffold

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
  }, 120_000)

  afterAll(async () => {
    await scaffold?.close()
  })

  it('registers a settings-declared route and lists its models', async () => {
    const before = await scaffold.ctx.llm.listProviders()
    expect(before.map(provider => provider.id)).not.toContain(ROUTE)

    // Exactly what the Custom provider card writes: one path op setting the
    // whole profile, through the settings Remote the browser calls.
    const view = await scaffold.ctx.settingsController.mutate(NS, [
      {
        op: 'set',
        path: ['providers', ROUTE],
        value: {
          displayName: 'Acme Gateway',
          api: 'openai-completions',
          baseURL: 'https://gateway.acme.example/v1',
          models: [{ id: MODEL, name: 'Acme Large' }],
        },
      },
    ], undefined)
    expect(view.user).toMatchObject({ providers: { [ROUTE]: { baseURL: 'https://gateway.acme.example/v1' } } })

    await expect.poll(async () => (await scaffold.ctx.llm.listProviders()).map(p => p.id), { timeout: 10_000 })
      .toContain(ROUTE)
    expect((await scaffold.ctx.llm.listModels(ROUTE)).map(model => model.id)).toEqual([MODEL])

    // The composer seat reads this catalog.
    const catalog = await scaffold.ctx.sessionController.modelCatalog()
    const group = catalog.groups.find(entry => entry.id === ROUTE)
    expect(group?.models.map(model => model.id)).toEqual([MODEL])
    expect(catalog.routableProviders).toContain(ROUTE)
  }, 60_000)
})
