// @vitest-environment jsdom
/** Text selection, editing, and feature-menu arbitration in the shell. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextMenu } from '../src/client/ContextMenu.tsx'

const exec = vi.fn(() => true)
const writeText = vi.fn(async (_text: string) => {})
const readText = vi.fn(async () => 'pasted')
const originalExec = Object.getOwnPropertyDescriptor(document, 'execCommand')
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

beforeEach(() => {
  exec.mockReset().mockReturnValue(true)
  writeText.mockReset().mockResolvedValue(undefined)
  readText.mockReset().mockResolvedValue('pasted')
  Object.defineProperty(document, 'execCommand', { configurable: true, value: exec })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText, readText } })
})
afterEach(() => {
  cleanup()
  window.getSelection()?.removeAllRanges()
  if (originalExec === undefined) Reflect.deleteProperty(document, 'execCommand')
  else Object.defineProperty(document, 'execCommand', originalExec)
  if (originalClipboard === undefined) Reflect.deleteProperty(navigator, 'clipboard')
  else Object.defineProperty(navigator, 'clipboard', originalClipboard)
  vi.restoreAllMocks()
})

function menu() { return <ContextMenu t={key => key} /> }
function open(element: Element) { return fireEvent.contextMenu(element, { clientX: 40, clientY: 60 }) }
async function choose(name: string) {
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name })) })
}

describe('application context menu', () => {
  it('suppresses browser chrome on blank areas without showing an empty menu', () => {
    render(<>{menu()}<div data-testid="blank" /></>)
    expect(open(screen.getByTestId('blank'))).toBe(false)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('keeps a feature-owned context menu and terminal gestures', () => {
    render(<>{menu()}<button onContextMenu={event => { event.preventDefault() }}>feature</button><div className="xterm">terminal</div></>)
    open(screen.getByText('feature'))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(open(screen.getByText('terminal'))).toBe(true)
  })

  it('copies only selected transcript text', async () => {
    render(<>{menu()}<p>selected text</p></>)
    const text = screen.getByText('selected text').firstChild!
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 8)
    window.getSelection()?.addRange(range)
    open(screen.getByText('selected text'))
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['copy'])
    await choose('copy')
    expect(writeText).toHaveBeenCalledWith('selected')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('restores input selection before cutting or pasting', async () => {
    render(<>{menu()}<textarea defaultValue="alpha beta" /></>)
    const input = screen.getByRole<HTMLTextAreaElement>('textbox')
    input.focus()
    input.setSelectionRange(6, 10)
    open(input)
    await choose('context.cut')
    expect(writeText).toHaveBeenCalledWith('beta')
    expect(exec).toHaveBeenCalledWith('delete', false, undefined)
    open(input)
    await choose('context.paste')
    expect(document.activeElement).toBe(input)
    expect([input.selectionStart, input.selectionEnd]).toEqual([6, 10])
    expect(exec).toHaveBeenCalledWith('insertText', false, 'pasted')
  })

  it('does not delete when copying a cut selection fails', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    render(<>{menu()}<textarea defaultValue="draft" /></>)
    const input = screen.getByRole<HTMLTextAreaElement>('textbox')
    input.setSelectionRange(0, 5)
    open(input)
    await choose('context.cut')
    expect(exec).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe('context.failed')
  })

  it('omits mutation actions for read-only fields and protects password text', () => {
    render(<>{menu()}<textarea readOnly defaultValue="read only" /><input type="password" defaultValue="secret" /></>)
    const input = screen.getByRole<HTMLTextAreaElement>('textbox')
    input.select()
    open(input)
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['copy', 'context.selectAll'])
    const password = document.querySelector('input')!
    password.select()
    open(password)
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'copy' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'context.cut' }).disabled).toBe(true)
  })

  it('copies safe link addresses and opens through the existing link handler', async () => {
    const clicked = vi.fn((event: React.MouseEvent) => { event.preventDefault() })
    render(<>{menu()}<a href="https://example.com/path" onClick={clicked}>link</a><a href="javascript:void(0)">unsafe</a></>)
    open(screen.getByText('link'))
    await choose('context.copyLink')
    expect(writeText).toHaveBeenCalledWith('https://example.com/path')
    open(screen.getByText('link'))
    await choose('context.openLink')
    expect(clicked).toHaveBeenCalledOnce()
    open(screen.getByText('unsafe'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('routes contenteditable undo through the editor input handler', async () => {
    const beforeInput = vi.fn((event: Event) => { event.preventDefault() })
    render(<>{menu()}<div contentEditable data-testid="editor" /></>)
    const editor = screen.getByTestId('editor')
    editor.addEventListener('beforeinput', beforeInput)
    open(editor)
    await choose('context.undo')
    expect(beforeInput.mock.calls[0]?.[0]).toHaveProperty('inputType', 'historyUndo')
    expect(exec).not.toHaveBeenCalled()
  })

  it('abandons pending paste when the user moves to another field', async () => {
    let resolveRead!: (text: string) => void
    readText.mockImplementation(() => new Promise(resolve => { resolveRead = resolve }))
    render(<>{menu()}<textarea aria-label="first" /><textarea aria-label="second" /></>)
    open(screen.getByLabelText('first'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'context.paste' }))
    fireEvent.pointerDown(screen.getByLabelText('second'))
    await act(async () => { resolveRead('late text') })
    expect(exec).not.toHaveBeenCalled()
  })

  it('selects all in an input and dismisses on Escape and scroll', async () => {
    render(<>{menu()}<textarea defaultValue="draft" /></>)
    const input = screen.getByRole<HTMLTextAreaElement>('textbox')
    open(input)
    await choose('context.selectAll')
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5])
    open(input)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(document.activeElement).toBe(input)
    expect(screen.queryByRole('menu')).toBeNull()
    open(input)
    fireEvent.scroll(window)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('removes global handlers on unmount', () => {
    const { unmount } = render(menu())
    unmount()
    expect(fireEvent.contextMenu(document.body)).toBe(true)
  })
})
