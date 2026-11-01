/** Exercise editing through the shipped shell and real Lexical composer. */
import { chromium, type Page } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

it('uses contextual actions without browser navigation chrome', async () => {
  const scaffold = await launchWebScaffold({})
  try {
    const browser = await chromium.launch()
    let failurePage: Page | undefined
    try {
      const page = await newEnglishPage(browser)
      failurePage = page
      const tripwire = watchConsole(page)
      await page.goto(scaffold.authenticatedUrl)
      await connectFreshWorkspace(page, scaffold.workspaceCwd, 'context-menu')
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
      const input = page.locator('[data-composer-input][contenteditable="true"]').first()
      await input.click()
      await page.keyboard.insertText('alpha beta')
      await page.keyboard.press('ControlOrMeta+KeyA')
      await input.click({ button: 'right' })
      expect(await page.getByRole('menu').innerText()).not.toMatch(/Back|Reload/)
      await page.getByRole('menuitem', { name: 'Copy', exact: true }).click()
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('alpha beta')
      await input.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Select all', exact: true }).click()
      await input.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Cut', exact: true }).click()
      await expect.poll(() => input.textContent()).toBe('')
      await input.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Undo', exact: true }).click()
      await expect.poll(() => input.textContent()).toBe('alpha beta')
      await input.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Redo', exact: true }).click()
      await expect.poll(() => input.textContent()).toBe('')
      await page.evaluate(() => navigator.clipboard.writeText('menu paste'))
      await input.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Paste', exact: true }).click()
      await expect.poll(() => input.textContent()).toBe('menu paste')
      await input.click({ button: 'right' })
      await page.keyboard.press('Escape')
      expect(await input.evaluate(element => element === document.activeElement)).toBe(true)
      await page.keyboard.press('End')
      await page.keyboard.insertText(' continued')
      await expect.poll(() => input.textContent()).toBe('menu paste continued')
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 800 })
        await input.click({ button: 'right' })
        const bounds = await page.getByRole('menu').boundingBox()
        expect(bounds).not.toBeNull()
        expect(bounds!.x).toBeGreaterThanOrEqual(0)
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(800)
        await saveFailureShot(page, `context-menu-${width}`)
        await page.keyboard.press('Escape')
      }
      expect(tripwire.pageErrors).toEqual([])
    } catch (error) {
      if (failurePage !== undefined) await saveFailureShot(failurePage, 'context-menu-failure')
      throw error
    } finally {
      await browser.close()
    }
  } finally {
    await scaffold.close()
  }
})
