// @vitest-environment jsdom

/** Desktop boot bridge keyboard behavior that native WebView history would otherwise own. */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const SRC_TAURI = resolve(import.meta.dirname, '../src-tauri')

/** @returns the JavaScript installed into every shell-window document. */
function bootBridge(): string {
  const source = readFileSync(join(SRC_TAURI, 'src/lib.rs'), 'utf8')
  const match = /const BOOT_BRIDGE: &str = r#"([\s\S]*?)"#;/u.exec(source)
  if (match?.[1] === undefined) throw new Error('lib.rs declares no BOOT_BRIDGE script')
  return match[1]
}

/** @param target - element the key event is dispatched to. @returns whether the browser default was prevented. */
function pressBackspace(target: Element): boolean {
  const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event.defaultPrevented
}

describe('desktop boot bridge keyboard handling', () => {
  beforeAll(() => {
    window.eval(bootBridge())
  })

  it('prevents Backspace from replaying boot outside editable targets', () => {
    const target = document.createElement('div')
    document.body.append(target)
    expect(pressBackspace(target)).toBe(true)
  })

  it.each(['input', 'textarea', 'contenteditable'] as const)('leaves Backspace to an editable %s', (kind) => {
    const target = kind === 'contenteditable' ? document.createElement('div') : document.createElement(kind)
    if (kind === 'contenteditable') {
      target.contentEditable = 'true'
      Object.defineProperty(target, 'isContentEditable', { value: true })
    }
    document.body.append(target)
    expect(pressBackspace(target)).toBe(false)
  })
})
