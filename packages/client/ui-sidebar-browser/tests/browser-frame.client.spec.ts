import { describe, expect, it, vi } from 'vitest'
import { IframeImpl } from '../src/client/browser/BrowserFrame.ts'

describe('IframeImpl', () => {
  it('owns transient sandbox mode and prepared document state', () => {
    const changed = vi.fn<(sandboxed: boolean) => void>()
    const loaded = vi.fn<(revision: number, url?: string) => void>()
    const frame = new IframeImpl(changed, loaded)
    const listener = vi.fn()
    const unsubscribe = frame.subscribe(listener)

    frame.toggleSandbox()
    expect(frame.getSnapshot().sandboxed).toBe(false)
    expect(changed).toHaveBeenCalledWith(false)

    const document = {
      target: { kind: 'https' as const, url: 'https://example.test/', title: 'example.test' },
      src: 'https://example.test/',
      revision: 4,
    }
    frame.reportLoadFailed(4)
    expect(frame.getSnapshot().loadFailed).toBe(false)
    frame.setDocument(document)
    frame.reportLoadFailed(3)
    expect(frame.getSnapshot().loadFailed).toBe(false)
    frame.reportLoadFailed(4)
    frame.reportLoadFailed(4)
    expect(frame.getSnapshot().loadFailed).toBe(true)
    frame.reportLoaded(4)
    expect(loaded).toHaveBeenCalledWith(4, undefined)
    frame.reportLoaded(4, 'https://example.test/final')
    expect(loaded).toHaveBeenCalledWith(4, 'https://example.test/final')
    frame.setDocument({ ...document, revision: 5 })
    expect(frame.getSnapshot().loadFailed).toBe(false)
    frame.clearDocument()
    expect(frame.getSnapshot().document).toBeUndefined()
    frame.reportLoadFailed(5)
    expect(frame.getSnapshot().loadFailed).toBe(false)
    frame.clearDocument()
    expect(listener).toHaveBeenCalled()
    unsubscribe()
  })

  it('tracks component-picker mode for the tab occurrence', () => {
    const changed = vi.fn<(sandboxed: boolean) => void>()
    const loaded = vi.fn<(revision: number, url?: string) => void>()
    const frame = new IframeImpl(changed, loaded)
    const listener = vi.fn()
    frame.subscribe(listener)

    expect(frame.getSnapshot().picker).toBe('inactive')
    frame.stopPicker()
    expect(listener).not.toHaveBeenCalled()

    frame.startPicker()
    expect(frame.getSnapshot().picker).toBe('active')
    frame.startPicker()
    expect(frame.getSnapshot().picker).toBe('active')

    frame.failPicker()
    expect(frame.getSnapshot().picker).toBe('failed')
    frame.stopPicker()
    expect(frame.getSnapshot().picker).toBe('inactive')

    frame.failPicker()
    frame.setDocument({
      target: { kind: 'https' as const, url: 'https://example.test/', title: 'example.test' },
      src: 'https://example.test/',
      revision: 7,
    })
    expect(frame.getSnapshot().picker).toBe('failed')
    frame.stopPicker()
    expect(frame.getSnapshot().picker).toBe('inactive')
    expect(listener).toHaveBeenCalled()
  })

  it('returns rendering to the iframe after one native carrier refusal', () => {
    const changed = vi.fn<(sandboxed: boolean) => void>()
    const loaded = vi.fn<(revision: number, url?: string) => void>()
    const frame = new IframeImpl(changed, loaded)
    const listener = vi.fn()
    frame.subscribe(listener)
    const document = {
      target: { kind: 'https' as const, url: 'https://example.test/', title: 'example.test' },
      src: 'https://example.test/',
      revision: 9,
    }

    expect(frame.getSnapshot().nativeFailed).toBe(false)
    frame.failNative()
    expect(frame.getSnapshot().nativeFailed).toBe(true)
    frame.failNative()
    expect(frame.getSnapshot().nativeFailed).toBe(true)
    expect(listener).toHaveBeenCalledOnce()

    frame.setDocument(document)
    expect(frame.getSnapshot().nativeFailed).toBe(false)
    expect(frame.getSnapshot().loadFailed).toBe(false)
  })
})
