// Browser e2e, zh: the composer seat and the Models settings page read one
// Host catalog. A route the page declares has to reach the seat under the
// names the page wrote — the provider by its display name, the model by its
// own — and picking it there has to land as the live selection, written back
// as the Agent default later sessions start from. A seat stuck on the
// deployment's own route while the page shows the new one is the regression
// this pins down. Zero model calls: the declare is settings traffic and the
// catalog read is what the seat renders from, so a stray stream would fail
// loud because the adapter registry is empty.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { ZH_BROWSER_LOCALE, connectFreshWorkspaceZh, saveFailureShot } from './support.ts'

/** The route this scenario declares through the Custom provider card. */
const ROUTE = 'acme-gateway'
const ROUTE_NAME = 'Acme Gateway'
const MODEL = 'acme-large'
const MODEL_NAME = 'Acme Large'
const BASE_URL = 'https://gateway.acme.example/v1'
/** The first-run DeepSeek step, a modal that blocks everything behind it. */
const SETUP_STEP = '添加一个 API Key 开始使用'

describe('web e2e: a provider the Models page declares reaches the composer seat', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  /** The seat trigger, found by its accessible name rather than its label. */
  const seat = (): ReturnType<Page['getByRole']> => page.getByRole('button', { name: /^选择模型/ })

  /** Open the seat and drill into the model pane. */
  const openModelPane = async (): Promise<void> => {
    await seat().click()
    await page.getByRole('menuitem', { name: /模型/ }).click()
  }

  beforeAll(async () => {
    // The official DeepSeek adapter stays mounted with no credential, so the
    // route under test is added beside it rather than replacing it.
    scaffold = await launchWebScaffold({ deepSeekMissingCredential: true })
    browser = await chromium.launch()
    // The scenario asserts the shipped Chinese copy, so the browser asks for it.
    page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    const setupStep = page.getByRole('dialog', { name: SETUP_STEP })
    await setupStep.waitFor({ timeout: 15_000 })
    await setupStep.getByRole('button', { name: '稍后配置' }).click()
    await setupStep.waitFor({ state: 'detached', timeout: 15_000 })
    // The seat only exists once a workspace is connected.
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('offers the mounted route on the seat under its model names', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-model-seat-mounted'))
    const trigger = seat()
    await trigger.waitFor({ timeout: 15_000 })
    // The seat names the model, not the route/model pair: the deployment
    // default resolves through the mounted catalog, whose flash entry is
    // spelled `DeepSeek-V41-Flash`.
    await expect.poll(async () => (await trigger.textContent()) ?? '', { timeout: 15_000 })
      .toContain('DeepSeek-V41-Flash')

    await openModelPane()
    const options = page.getByRole('menuitemradio')
    await expect.poll(async () => options.count(), { timeout: 15_000 }).toBeGreaterThan(1)
    expect(await options.filter({ hasText: 'DeepSeek-V41-Flash' }).count()).toBe(1)
    expect(await options.filter({ hasText: 'DeepSeek-V4-Pro' }).count()).toBe(1)
    // The group heading is the provider's own name; a raw route key here would
    // read as a second, undocumented selector.
    expect(await page.getByRole('group', { name: 'DeepSeek' }).count()).toBe(1)

    // Escape leaves a drilled pane before it closes the card, so the first
    // keystroke only returns to the root pane.
    await page.keyboard.press('Escape')
    await expect.poll(
      async () => page.getByRole('menuitemradio').count(),
      { timeout: 10_000 },
    ).toBe(0)
    await page.keyboard.press('Escape')
    await expect.poll(async () => page.getByRole('menu').count(), { timeout: 10_000 }).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('switches to a route the Models page declares, and saves it as the default', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-model-seat-custom'))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: '模型' }).click()
    // The Custom provider card declares a route no installed catalog lists.
    const declare = dialog.getByRole('button', { name: '添加自定义提供方' })
    await declare.waitFor({ timeout: 10_000 })
    await declare.click()
    await dialog.getByRole('textbox', { name: 'Provider ID' }).fill(ROUTE)
    await dialog.getByRole('textbox', { name: '显示名称', exact: true }).fill(ROUTE_NAME)
    await dialog.getByRole('textbox', { name: 'API 地址' }).fill(BASE_URL)
    // Endpoint, protocol, and one model are the three things a hand-declared
    // route cannot default, so the card refuses the create without them.
    const create = dialog.getByRole('button', { name: '创建提供方' })
    await expect.poll(async () => create.isEnabled(), { timeout: 10_000 }).toBe(false)
    await dialog.getByRole('button', { name: '添加模型' }).click()
    await dialog.getByRole('textbox', { name: '模型 ID 1' }).fill(MODEL)
    await dialog.getByRole('textbox', { name: '显示名称 1' }).fill(MODEL_NAME)
    await expect.poll(async () => create.isEnabled(), { timeout: 10_000 }).toBe(true)
    await create.click()
    await expect.poll(
      async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'),
      { timeout: 15_000 },
    ).toContain(`${ROUTE}:`)

    // The card closes itself once the profile lands; leave the dialog so the
    // seat can be reached again.
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    await dialog.waitFor({ state: 'detached', timeout: 15_000 })

    await openModelPane()
    // The declared route is a group of its own, and its model is named by the
    // display name the card wrote rather than by its id.
    await expect.poll(
      async () => page.getByRole('group', { name: ROUTE_NAME }).count(),
      { timeout: 15_000 },
    ).toBe(1)
    const added = page.getByRole('menuitemradio', { name: MODEL_NAME })
    await expect.poll(async () => added.count(), { timeout: 15_000 }).toBe(1)
    await added.click()

    // The seat shows what the page wrote, and the switch is persisted as the
    // default a later session starts from.
    await expect.poll(async () => (await seat().textContent()) ?? '', { timeout: 15_000 })
      .toContain(MODEL_NAME)
    await expect.poll(
      async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'),
      { timeout: 10_000 },
    ).toContain('agent-default-model:')
    const stored = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(stored).toContain(`provider: ${ROUTE}`)
    expect(stored).toContain(`model: ${MODEL}`)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
