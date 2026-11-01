/** Application text and link actions; feature-owned menus take precedence. */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@mutantcat/dsh-client-ui-slots'
import { IconCopyOutline16, IconLinkOutline16, Menu, Toast, writeClipboard } from '@mutantcat/dsh-client-ui-primitives'
import type { MenuEntry } from '@mutantcat/dsh-client-ui-primitives'

type TextInput = HTMLInputElement | HTMLTextAreaElement
interface Target {
  element: HTMLElement
  input: TextInput | null
  start: number | null
  end: number | null
  range: Range | null
  text: string
  editable: boolean
  link: HTMLAnchorElement | null
  rect: DOMRect
}

function resolveTarget(event: MouseEvent): Target | null {
  if (!(event.target instanceof Element)) return null
  const node = event.target
  const field = node.closest('input, textarea')
  const input = field instanceof HTMLTextAreaElement || (field instanceof HTMLInputElement
    && ['text', 'search', 'url', 'tel', 'email', 'password', 'number'].includes(field.type)) ? field : null
  const editableParent = node.closest<HTMLElement>('[contenteditable]')
  const editor = editableParent?.getAttribute('contenteditable') === 'true'
    || editableParent?.getAttribute('contenteditable') === 'plaintext-only' ? editableParent : null
  const element = input ?? editor ?? node.closest<HTMLElement>('*')
  if (element === null) return null
  const selection = window.getSelection()
  const range = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null
  const start = input?.selectionStart ?? null
  const end = input?.selectionEnd ?? null
  const password = input instanceof HTMLInputElement && input.type === 'password'
  const text = password ? '' : input !== null
    ? start === null || end === null ? '' : input.value.slice(start, end)
    : selection?.toString() ?? ''
  const editable = input !== null ? !input.disabled && !input.readOnly : editor !== null
  const candidate = node.closest<HTMLAnchorElement>('a[href]')
  const link = candidate !== null && /^(https?:|mailto:|tel:)$/.test(new URL(candidate.href, document.baseURI).protocol) ? candidate : null
  if (input === null && editor === null && text.length === 0 && link === null) return null
  return { element, input, start, end, range, text, editable, link, rect: new DOMRect(event.clientX, event.clientY, 0, 0) }
}

function restore(target: Target): void {
  target.element.focus({ preventScroll: true })
  if (target.input !== null && target.start !== null && target.end !== null) {
    target.input.setSelectionRange(target.start, target.end)
  } else if (target.range !== null) {
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(target.range)
  }
}

function edit(target: Target, command: string, value?: string): boolean {
  if (target.input === null && (command === 'undo' || command === 'redo' || command === 'delete')) {
    return !target.element.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true, cancelable: true,
      inputType: command === 'delete' ? 'deleteContentBackward' : command === 'undo' ? 'historyUndo' : 'historyRedo',
    }))
  }
  // Native editing preserves input undo history and emits input events for controlled fields.
  /* oxlint-disable-next-line typescript/no-deprecated */
  return document.execCommand(command, false, value)
}

/**
 * Replace browser chrome menus with actions for the clicked text or link.
 * @param props - localized common vocabulary.
 * @returns the portaled action menu and failure feedback.
 */
export function ContextMenu({ t }: PropsLocale<'common'>) {
  const [target, setTarget] = useState<Target | null>(null)
  const [failed, setFailed] = useState(false)
  const active = useRef<Target | null>(null)
  useEffect(() => {
    const open = (event: MouseEvent) => {
      // Terminal and code-editor carriers own their selection and edit commands.
      if (event.defaultPrevented || (event.target instanceof Element
        && event.target.closest('.xterm, .monaco-editor, .cm-editor') !== null)) return
      const next = resolveTarget(event)
      event.preventDefault()
      active.current = next
      setFailed(false)
      setTarget(next)
    }
    const dismiss = () => { active.current = null; setTarget(null) }
    const cancelPending = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('[role="menu"]') !== null) return
      active.current = null
    }
    document.addEventListener('contextmenu', open)
    document.addEventListener('pointerdown', cancelPending)
    document.addEventListener('input', cancelPending)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      active.current = null
      document.removeEventListener('contextmenu', open)
      document.removeEventListener('pointerdown', cancelPending)
      document.removeEventListener('input', cancelPending)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [])

  const items: MenuEntry[] = []
  if (target?.editable === true) {
    items.push({ id: 'undo', label: t('context.undo') }, { id: 'redo', label: t('context.redo') }, { type: 'separator', id: 'editing' })
    items.push({ id: 'cut', label: t('context.cut'), disabled: target.text.length === 0 })
  }
  if (target !== null && (target.text.length > 0 || target.editable || target.input !== null)) {
    items.push({ id: 'copy', label: t('copy'), icon: <IconCopyOutline16 />, disabled: target.text.length === 0 })
  }
  if (target?.editable === true) items.push({ id: 'paste', label: t('context.paste') })
  if (target !== null && (target.input !== null || target.editable)) items.push({ id: 'selectAll', label: t('context.selectAll') })
  if (target?.link !== null && target?.link !== undefined) {
    if (items.length > 0) items.push({ type: 'separator', id: 'link' })
    items.push({ id: 'openLink', label: t('context.openLink'), icon: <IconLinkOutline16 /> }, { id: 'copyLink', label: t('context.copyLink'), icon: <IconCopyOutline16 /> })
  }

  const select = async (id: string): Promise<void> => {
    if (target === null || !target.element.isConnected) return
    const saved = target
    setTarget(null)
    restore(saved)
    let success = true
    try {
      if (id === 'copy' || id === 'copyLink' || id === 'cut') {
        success = await writeClipboard(id === 'copyLink' ? saved.link?.href ?? '' : saved.text)
        if (id === 'cut' && success && active.current === saved && saved.element.isConnected) {
          restore(saved)
          success = edit(saved, 'delete')
        }
      } else if (id === 'paste') {
        const text = await navigator.clipboard.readText()
        if (active.current !== saved || !saved.element.isConnected) return
        restore(saved)
        if (saved.input !== null) {
          success = edit(saved, 'insertText', text)
        } else {
          const data = new DataTransfer()
          data.setData('text/plain', text)
          const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
          if (saved.element.dispatchEvent(event)) success = edit(saved, 'insertText', text)
        }
      } else if (id === 'openLink') {
        saved.link?.click()
      } else if (id === 'selectAll' && saved.input !== null) {
        saved.input.select()
      } else {
        success = edit(saved, id)
      }
    } catch (error) {
      // Clipboard permissions and native editing commands can reject the action.
      success = false
    }
    if (!success) setFailed(true)
  }

  return <>
    {target !== null && items.length > 0 && <Menu
      open autoFocus compact portal anchor={null} items={items}
      getAnchorRect={() => target.rect}
      onSelect={id => { void select(id) }}
      onClose={() => {
        if (document.activeElement?.closest('[role="menu"]') !== null) restore(target)
        active.current = null
        setTarget(null)
      }}
    />}
    {failed && <Toast text={t('context.failed')} onDone={() => { setFailed(false) }} />}
  </>
}
