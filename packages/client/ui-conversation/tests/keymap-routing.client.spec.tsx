// @vitest-environment jsdom
/**
 * Keymap routing at the DOM boundary: synthetic keydowns on the
 * contenteditable reach the registered composer commands (the jsdom lane's
 * gesture entry, below the full component bench). The edge cases below seed
 * a real caret beside a chip so the horizontal document-edge guard stays
 * observable at this boundary.
 */
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import type { LexicalEditor } from 'lexical'
import {
  $createParagraphNode, $createTextNode, $getRoot, $setSelection, COMMAND_PRIORITY_EDITOR,
  createEditor, KEY_ARROW_LEFT_COMMAND, KEY_ARROW_RIGHT_COMMAND,
} from 'lexical'
import { registerPlainText } from '@lexical/plain-text'
import type { ReferenceInsert } from '../src/client/contract/draft-editor.ts'
import {
  $createReferenceChipNode, ReferenceChipNode,
} from '../src/client/input/editor/chip-node.tsx'
import type { ComposerKeymapHandlers } from '../src/client/input/editor/keymap.ts'
import { registerComposerKeymap } from '../src/client/input/editor/keymap.ts'
import { ATOMIC_CHAR, $projectComposer } from '../src/client/input/editor/projection.ts'
import type { DetectSpan } from '../src/client/input/editor/span-map.ts'
import { $selectDetectSpan } from '../src/client/input/editor/span-map.ts'

/** A chip beside the seeded text, standing in for any opaque reference. */
const CHIP_REF: ReferenceInsert = {
  source: 'session-reference',
  ref: 'session-a',
  label: 'chip',
  clipboardText: '@session:chip',
}

const IDLE_HANDLERS: ComposerKeymapHandlers = {
  arbitrate: () => 'pass', space: () => false, dismissPopup: () => {},
  canSubmit: () => false, submit: () => {}, intakeFiles: () => {}, pasteText: () => {},
}

/**
 * Bind an editor holding `ask [chip] now` (detect length 9, chip at detect
 * 4) with the caret placed on one detect span. The paragraph commits before
 * the caret so the DOM selection resolves against a reconciled tree.
 * @param span - detect span to place the caret on.
 * @param withPlainText - also register @lexical/plain-text, whose own arrow
 * handling the guard must preempt.
 * @returns the editor and its contenteditable root.
 */
function edgeEditor(span: DetectSpan, withPlainText: boolean): { editor: LexicalEditor; root: HTMLElement } {
  const editor = createEditor({
    namespace: 'keymap-edges',
    nodes: [ReferenceChipNode],
    onError: (error) => { throw error },
  })
  const root = document.createElement('div')
  root.contentEditable = 'true'
  document.body.append(root)
  editor.setRootElement(root)
  const disposers = [registerComposerKeymap(editor, IDLE_HANDLERS)]
  if (withPlainText) disposers.push(registerPlainText(editor))
  editor.update(() => {
    const paragraph = $createParagraphNode()
    paragraph.append($createTextNode('ask '), $createReferenceChipNode(CHIP_REF), $createTextNode(' now'))
    $getRoot().append(paragraph)
  }, { discrete: true })
  editor.update(() => {
    $selectDetectSpan(span)
  }, { discrete: true })
  onTestFinished(() => {
    for (const dispose of disposers) dispose()
    editor.setRootElement(null)
    root.remove()
  })
  return { editor, root }
}

/** Assert the seed reads the way the case assumes before it fires a key. */
function expectSeed(editor: LexicalEditor, span: DetectSpan): void {
  const projection = editor.getEditorState().read(() => $projectComposer(() => 0))
  expect(projection.detectText).toBe(`ask ${ATOMIC_CHAR} now`)
  expect(projection.selection).toEqual({ start: span.start, end: span.end })
}

describe('keymap keydown routing', () => {
  it('clears composition presentation on root swaps and unregisters pending callbacks', async () => {
    const editor = createEditor({ namespace: 'composition-root', onError: (e) => { throw e } })
    const first = document.createElement('div')
    const second = document.createElement('div')
    document.body.append(first, second)
    onTestFinished(() => {
      editor.setRootElement(null)
      first.remove()
      second.remove()
    })
    editor.setRootElement(first)
    const unregister = registerComposerKeymap(editor, {
      arbitrate: () => 'pass', space: () => false, dismissPopup: () => {},
      canSubmit: () => false, submit: () => {}, intakeFiles: () => {}, pasteText: () => {},
    })
    onTestFinished(unregister)
    fireEvent.compositionStart(first)
    expect(first.hasAttribute('data-composer-composing')).toBe(true)
    editor.setRootElement(second)
    expect(first.hasAttribute('data-composer-composing')).toBe(false)
    expect(second.hasAttribute('data-composer-composing')).toBe(false)
    fireEvent.compositionStart(first)
    expect(first.hasAttribute('data-composer-composing')).toBe(false)
    fireEvent.compositionStart(second)
    expect(second.hasAttribute('data-composer-composing')).toBe(true)
    fireEvent.compositionEnd(second, { data: '' })
    unregister()
    await Promise.resolve()
    expect(second.hasAttribute('data-composer-composing')).toBe(false)
    fireEvent.compositionStart(second)
    expect(second.hasAttribute('data-composer-composing')).toBe(false)
  })

  it('routes Enter to the keymap submit handler', () => {
    const editor = createEditor({ namespace: 'keymap-routing', onError: (e) => { throw e } })
    const root = document.createElement('div')
    root.contentEditable = 'true'
    document.body.appendChild(root)
    editor.setRootElement(root)
    registerPlainText(editor)
    const submit = vi.fn()
    registerComposerKeymap(editor, {
      arbitrate: () => 'pass',
      space: () => false,
      dismissPopup: () => {},
      canSubmit: () => true,
      submit,
      intakeFiles: () => {},
      pasteText: () => {},
    })
    fireEvent.keyDown(root, { key: 'Enter' })
    expect(submit).toHaveBeenCalledWith(false)
    fireEvent.keyDown(root, { key: 'Enter', metaKey: true })
    expect(submit).toHaveBeenCalledWith(true)
  })

  it('routes Tab through arbitration and passes when unconsumed', () => {
    const editor = createEditor({ namespace: 'keymap-routing', onError: (e) => { throw e } })
    const root = document.createElement('div')
    root.contentEditable = 'true'
    document.body.appendChild(root)
    editor.setRootElement(root)
    registerPlainText(editor)
    const arbitrate = vi.fn<(key: string, composing: boolean) => 'consumed' | 'pick-highlighted' | 'pass'>()
      .mockReturnValueOnce('consumed')
      .mockReturnValueOnce('pick-highlighted')
      .mockReturnValue('pass')
    registerComposerKeymap(editor, {
      arbitrate,
      space: () => false,
      dismissPopup: () => {},
      canSubmit: () => true,
      submit: () => {},
      intakeFiles: () => {},
      pasteText: () => {},
    })
    const consumed = fireEvent.keyDown(root, { key: 'Tab', keyCode: 9 })
    expect(arbitrate).toHaveBeenCalledWith('tab', false)
    expect(consumed).toBe(false) // consumed: preventDefault fired
    const picked = fireEvent.keyDown(root, { key: 'Tab', keyCode: 9 })
    expect(picked).toBe(false) // picked: the completion replaces native traversal
    const passed = fireEvent.keyDown(root, { key: 'Tab', keyCode: 9 })
    expect(passed).toBe(true) // pass: the browser keeps native focus traversal

    // Shift+Tab is the menu's exit key, never its settle key.
    fireEvent.keyDown(root, { key: 'Tab', keyCode: 9, shiftKey: true })
    expect(arbitrate).toHaveBeenLastCalledWith('tabBack', false)
  })
})

describe('keymap horizontal document edge', () => {
  it('consumes ArrowLeft at the document edge', () => {
    const { editor, root } = edgeEditor({ start: 0, end: 0 }, false)
    expectSeed(editor, { start: 0, end: 0 })
    // The probe sits below CRITICAL: reaching it would mean the guard passed.
    const probe = vi.fn(() => false)
    onTestFinished(editor.registerCommand(KEY_ARROW_LEFT_COMMAND, probe, COMMAND_PRIORITY_EDITOR))
    expect(fireEvent.keyDown(root, { key: 'ArrowLeft', keyCode: 37 })).toBe(false)
    expect(probe).not.toHaveBeenCalled()
  })

  it('consumes ArrowRight at the document edge', () => {
    const { editor, root } = edgeEditor({ start: 9, end: 9 }, false)
    expectSeed(editor, { start: 9, end: 9 })
    const probe = vi.fn(() => false)
    onTestFinished(editor.registerCommand(KEY_ARROW_RIGHT_COMMAND, probe, COMMAND_PRIORITY_EDITOR))
    expect(fireEvent.keyDown(root, { key: 'ArrowRight', keyCode: 39 })).toBe(false)
    expect(probe).not.toHaveBeenCalled()
  })

  it('passes a horizontal arrow that still has a position to move to', () => {
    // Beside the chip in both directions the caret is not at the edge, so the
    // gesture stays available to plain-text's own character movement.
    const backward = edgeEditor({ start: 4, end: 4 }, false)
    expectSeed(backward.editor, { start: 4, end: 4 })
    const leftProbe = vi.fn(() => false)
    onTestFinished(backward.editor.registerCommand(KEY_ARROW_LEFT_COMMAND, leftProbe, COMMAND_PRIORITY_EDITOR))
    expect(fireEvent.keyDown(backward.root, { key: 'ArrowLeft', keyCode: 37 })).toBe(true)
    expect(leftProbe).toHaveBeenCalledTimes(1)

    const forward = edgeEditor({ start: 5, end: 5 }, false)
    expectSeed(forward.editor, { start: 5, end: 5 })
    const rightProbe = vi.fn(() => false)
    onTestFinished(forward.editor.registerCommand(KEY_ARROW_RIGHT_COMMAND, rightProbe, COMMAND_PRIORITY_EDITOR))
    expect(fireEvent.keyDown(forward.root, { key: 'ArrowRight', keyCode: 39 })).toBe(true)
    expect(rightProbe).toHaveBeenCalledTimes(1)
  })

  it('passes an ArrowLeft the IME owns', () => {
    // Lexical drops a keydown while composing through its own state, so the
    // event's isComposing flag is the guard's only witness here.
    const { root } = edgeEditor({ start: 0, end: 0 }, false)
    expect(fireEvent.keyDown(root, { key: 'ArrowLeft', keyCode: 37, isComposing: true })).toBe(true)
  })

  it('passes an ArrowLeft the legacy composition signal owns', () => {
    // keyCode 229 is the legacy IME signal engines emit without isComposing.
    const { root } = edgeEditor({ start: 0, end: 0 }, false)
    expect(fireEvent.keyDown(root, { key: 'ArrowLeft', keyCode: 229 })).toBe(true)
  })

  it('passes an ArrowLeft over a range or without a selection', () => {
    const ranged = edgeEditor({ start: 0, end: 2 }, false)
    expectSeed(ranged.editor, { start: 0, end: 2 })
    expect(fireEvent.keyDown(ranged.root, { key: 'ArrowLeft', keyCode: 37 })).toBe(true)

    const empty = edgeEditor({ start: 0, end: 0 }, false)
    expectSeed(empty.editor, { start: 0, end: 0 })
    empty.editor.update(() => {
      $setSelection(null)
    }, { discrete: true })
    expect(fireEvent.keyDown(empty.root, { key: 'ArrowLeft', keyCode: 37 })).toBe(true)
  })

  it('consumes the document edge ahead of @lexical/plain-text', () => {
    // plain-text would decline both gestures itself; jsdom has no
    // Selection.modify, so its fallback would throw if it ever ran.
    const backward = edgeEditor({ start: 0, end: 0 }, true)
    expectSeed(backward.editor, { start: 0, end: 0 })
    expect(fireEvent.keyDown(backward.root, { key: 'ArrowLeft', keyCode: 37 })).toBe(false)

    const forward = edgeEditor({ start: 9, end: 9 }, true)
    expectSeed(forward.editor, { start: 9, end: 9 })
    expect(fireEvent.keyDown(forward.root, { key: 'ArrowRight', keyCode: 39 })).toBe(false)
  })
})
