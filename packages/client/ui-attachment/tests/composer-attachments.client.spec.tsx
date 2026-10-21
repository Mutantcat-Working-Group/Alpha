// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type {
  ComposerAttachment, ComposerAttachmentsOwnerProps, ComposerAttachmentsProps,
} from '@mutantcat/dsh-client-ui-conversation/client'
import { ComposerAttachments } from '../src/client/ComposerAttachments.tsx'
import { localPathOf } from '../src/client/drop-events.ts'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t = ((key: string, params?: Readonly<Record<string, unknown>>): string => {
  const messages: Record<string, string> = {
    'attachment.pending': '待发送附件',
    'attachment.scrollLeft': '向左滚动附件',
    'attachment.scrollRight': '向右滚动附件',
    'file.pending': '待发送文件',
    'file.uploading': '上传中…',
    'file.uploadFailed': '上传失败，点击重试',
    'file.label': '文件',
    'image.pending': '待发送图片',
    'image.original': '原图',
    'image.preview': '原图预览',
    'image.closePreview': '关闭原图预览',
    'image.openOriginal': '查看原图',
    'attachment.dropBlocked': '当前无法添加文件或图片',
    'attachment.dropTitle': '文件或图片拖动到此处即可添加',
  }
  if (key === 'file.remove') {
    const name = params?.name
    return `移除文件 ${typeof name === 'string' ? name : ''}`
  }
  if (key === 'file.retry') {
    const name = params?.name
    return `重试上传 ${typeof name === 'string' ? name : ''}`
  }
  if (key === 'image.remove') {
    const name = params?.name
    return `移除图片 ${typeof name === 'string' ? name : ''}`
  }
  if (key === 'attachment.dropDesc') {
    const count = params?.count
    const size = params?.size
    return `图片限制：最多 ${typeof count === 'number' ? String(count) : ''} 张，每张 ${typeof size === 'string' ? size : ''}`
  }
  return messages[key] ?? key
}) as ComposerAttachmentsProps['t']

function attachment(id: string, name = `${id}.png`): ComposerAttachment {
  return {
    kind: 'image',
    id: id as ComposerAttachment['id'],
    file: new File([Uint8Array.of(1)], name, { type: 'image/png' }),
    previewUrl: `blob:${id}`,
  }
}

function fileDraft(id: string, name = `${id}.pdf`): ComposerAttachment {
  return {
    kind: 'file',
    id: id as ComposerAttachment['id'],
    file: new File([Uint8Array.of(1, 2, 3)], name, { type: 'application/pdf' }),
  }
}

function props(overrides: Partial<ComposerAttachmentsOwnerProps> = {}): ComposerAttachmentsProps {
  return {
    attachments: [],
    canAcceptDrop: true,
    onAddFiles: () => {},
    onDropPaths: () => {},
    onRemoveAttachment: () => {},
    uploads: {},
    onRetryFile: () => {},
    t,
    ...overrides,
  } as unknown as ComposerAttachmentsProps
}

/** One dropped item: a regular file, or a folder named by its entry. */
interface DroppedEntry {
  readonly file?: File
  readonly directory?: string
}

/**
 * A drop's transfer as the page reads it: file entries, folder entries, and the
 * text payloads a platform may disclose paths through.
 * @param entries - dropped items in order.
 * @param payloads - text payloads by MIME type, empty by default.
 * @returns the transfer stub, including its mutable drop effect.
 */
function transfer(
  entries: readonly DroppedEntry[],
  payloads: Readonly<Record<string, string>> = {},
) {
  const items = entries.map(entry => ({
    kind: 'file',
    getAsFile: (): File | null => entry.file ?? null,
    webkitGetAsEntry: () => ({ isDirectory: entry.directory !== undefined, name: entry.directory ?? entry.file?.name ?? '' }),
  }))
  return {
    types: ['Files'],
    files: entries.flatMap(entry => entry.file === undefined ? [] : [entry.file]),
    items,
    dropEffect: 'none',
    getData: (type: string): string => payloads[type] ?? '',
  }
}

describe('ComposerAttachments', () => {
  it('accepts file drops anywhere on the document and keeps non-file drags native', () => {
    const onAddFiles = vi.fn()
    const view = render(<ComposerAttachments {...props({
      onAddFiles,
      dropLimits: { count: 20, size: '5MB' },
    })} />)

    expect(fireEvent.dragEnter(document.body, { dataTransfer: null })).toBe(true)
    const textTransfer = { types: ['text/plain'], files: [], dropEffect: 'none' }
    expect(fireEvent.dragEnter(document.body, { dataTransfer: textTransfer })).toBe(true)
    expect(fireEvent.dragOver(document.body, { dataTransfer: textTransfer })).toBe(true)
    expect(fireEvent.drop(document.body, { dataTransfer: textTransfer })).toBe(true)
    expect(view.queryByRole('status')).toBeNull()

    const image = attachment('dropped').file
    const dataTransfer = transfer([{ file: image }])
    expect(fireEvent.dragEnter(document.body, { dataTransfer })).toBe(false)
    expect(view.getByRole('status').textContent).toContain('文件或图片拖动到此处即可添加')
    expect(view.getByRole('status').textContent).toContain('图片限制：最多 20 张，每张 5MB')
    expect(fireEvent.dragOver(document.body, { dataTransfer })).toBe(false)
    expect(dataTransfer.dropEffect).toBe('copy')
    expect(fireEvent.drop(document.body, { dataTransfer })).toBe(false)
    expect(onAddFiles).toHaveBeenCalledWith([image])
    expect(view.queryByRole('status')).toBeNull()
  })

  it('tracks nested file drags and clears an aborted drag', () => {
    const view = render(<ComposerAttachments {...props()} />)
    const dataTransfer = { types: ['Files'], files: [], dropEffect: 'none' }
    fireEvent.dragLeave(document.body, {
      dataTransfer: { types: ['text/plain'], files: [], dropEffect: 'none' },
    })
    fireEvent.dragEnter(document.body, { dataTransfer })
    fireEvent.dragEnter(document.body, { dataTransfer })
    fireEvent.dragLeave(document.body, { dataTransfer, clientX: 5, clientY: 5 })
    expect(view.getByRole('status')).toBeTruthy()
    fireEvent.dragLeave(document.body, { dataTransfer, clientX: 5, clientY: 5 })
    expect(view.queryByRole('status')).toBeNull()
    fireEvent.dragEnter(document.documentElement, { dataTransfer })
    const leftViewport = new Event('dragleave', { bubbles: true, cancelable: true })
    Object.defineProperties(leftViewport, {
      dataTransfer: { value: dataTransfer },
      clientX: { value: -1 },
      clientY: { value: 5 },
    })
    fireEvent(document.documentElement, leftViewport)
    expect(view.queryByRole('status')).toBeNull()
    fireEvent.dragEnter(document.body, { dataTransfer })
    fireEvent.dragEnd(window, { dataTransfer })
    expect(view.queryByRole('status')).toBeNull()
  })

  it('shows a blocked drop without forwarding its files', () => {
    const onAddFiles = vi.fn()
    const view = render(<ComposerAttachments {...props({ canAcceptDrop: false, onAddFiles })} />)
    const image = attachment('blocked').file
    const dataTransfer = transfer([{ file: image }])
    dataTransfer.dropEffect = 'copy'
    fireEvent.dragEnter(document.body, { dataTransfer })
    expect(view.getByRole('status').textContent).toBe('当前无法添加文件或图片')
    fireEvent.dragOver(document.body, { dataTransfer })
    expect(dataTransfer.dropEffect).toBe('none')
    fireEvent.drop(document.body, { dataTransfer })
    expect(onAddFiles).not.toHaveBeenCalled()
    expect(view.queryByRole('status')).toBeNull()
  })

  it('routes rail removal and closes previews on Escape or attachment removal', () => {
    const onRemoveAttachment = vi.fn()
    const image = attachment('draft-1', 'pixel.png')
    const initial = props({ attachments: [image], onRemoveAttachment })
    const view = render(<ComposerAttachments {...initial} />)

    fireEvent.click(view.getByRole('button', { name: '移除图片 pixel.png' }))
    expect(onRemoveAttachment).toHaveBeenCalledWith(image.id)
    fireEvent.click(view.getByTitle('查看原图'))
    expect(view.getByRole('dialog', { name: '原图预览' })).toBeTruthy()
    view.rerender(<ComposerAttachments {...props({ attachments: [], onRemoveAttachment })} />)
    expect(view.queryByRole('dialog', { name: '原图预览' })).toBeNull()

    view.rerender(<ComposerAttachments {...initial} />)
    fireEvent.click(view.getByTitle('查看原图'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(view.queryByRole('dialog', { name: '原图预览' })).toBeNull()
  })

  it('keeps images and files in pick order inside one attachment rail', () => {
    const view = render(<ComposerAttachments {...props({
      attachments: [attachment('first'), fileDraft('middle'), attachment('last')],
      uploads: {
        middle: {
          status: 'ready', receiptId: 'receipt-middle' as never,
          file: { attachmentId: 'file-middle' as never, name: 'middle.pdf', bytes: 3 },
        },
      },
    })} />)
    const rail = view.getByRole('group', { name: '待发送附件' })
    expect([...rail.children].map((child) => {
      const image = child.querySelector('img')
      return image?.getAttribute('alt') ?? child.querySelector('[title]')?.getAttribute('title')
    })).toEqual(['first.png', 'middle.pdf', 'last.png'])
    expect(view.queryByRole('group', { name: '待发送文件' })).toBeNull()
  })

  it('labels an unnamed attachment and its original-image preview', () => {
    const image = attachment('unnamed', '')
    const view = render(<ComposerAttachments {...props({ attachments: [image] })} />)
    expect(view.getByAltText('待发送图片')).toBeTruthy()
    fireEvent.click(view.getByTitle('查看原图'))
    expect(view.getByAltText('原图')).toBeTruthy()
  })
})

describe('ComposerAttachments file drafts', () => {
  it('renders uploading, ready, and failed cards with remove and retry affordances', () => {
    const onRemoveAttachment = vi.fn()
    const onRetryFile = vi.fn()
    const view = render(<ComposerAttachments {...props({
      attachments: [fileDraft('up'), fileDraft('ok'), fileDraft('bad')],
      uploads: {
        up: { status: 'uploading', loaded: 1, total: 4 },
        ok: {
          status: 'ready', receiptId: 'receipt-ok' as never,
          file: { attachmentId: 'file-ok' as never, name: 'ok.pdf', bytes: 3 },
        },
        bad: { status: 'error', message: 'boom' },
      },
      onRemoveAttachment,
      onRetryFile,
    })} />)
    const group = view.getByRole('group', { name: '待发送附件' })
    expect(group.textContent).toContain('上传中…')
    expect(view.container.querySelector('[style="width: 25%;"]')).toBeTruthy()
    expect(group.textContent).toContain('ok.pdf')
    expect(group.textContent).toContain('PDF 3B')
    expect(group.textContent).toContain('上传失败，点击重试')
    fireEvent.click(view.getByRole('button', { name: '重试上传 bad.pdf' }))
    expect(onRetryFile).toHaveBeenCalledWith('bad')
    fireEvent.click(view.getByRole('button', { name: '移除文件 ok.pdf' }))
    expect(onRemoveAttachment).toHaveBeenCalledWith('ok')
  })

  it('treats a draft without upload state as uploading and keeps retry separate from remove', () => {
    const onRetryFile = vi.fn()
    const onRemoveAttachment = vi.fn()
    const view = render(<ComposerAttachments {...props({
      attachments: [fileDraft('pending'), fileDraft('bad')],
      uploads: { bad: { status: 'error', message: 'boom' } },
      onRetryFile,
      onRemoveAttachment,
    })} />)
    expect(view.getByRole('group', { name: '待发送附件' }).textContent).toContain('上传中…')
    const retry = view.getByRole('button', { name: '重试上传 bad.pdf' })
    const remove = view.getByRole('button', { name: '移除文件 bad.pdf' })
    expect(retry.contains(remove)).toBe(false)
    fireEvent.click(remove)
    expect(onRemoveAttachment).toHaveBeenCalledWith('bad')
    expect(onRetryFile).not.toHaveBeenCalled()
    fireEvent.click(retry)
    expect(onRetryFile).toHaveBeenCalledWith('bad')
  })

  it('uses the localized file label when the browser supplies no name', () => {
    const view = render(<ComposerAttachments {...props({
      attachments: [fileDraft('unnamed', '')],
      uploads: {
        unnamed: {
          status: 'ready', receiptId: 'receipt-unnamed' as never,
          file: { attachmentId: 'file-unnamed' as never, name: 'file', bytes: 3 },
        },
      },
    })} />)
    const group = view.getByRole('group', { name: '待发送附件' })
    expect(group.textContent).toContain('文件')
    expect(group.textContent).toContain('3B')
  })

  it('uses the shared leading-dot suffix in ready-file metadata', () => {
    const view = render(<ComposerAttachments {...props({
      attachments: [fileDraft('env', '.env')],
      uploads: {
        env: {
          status: 'ready', receiptId: 'receipt-env' as never,
          file: { attachmentId: 'file-env' as never, name: '.env', bytes: 3 },
        },
      },
    })} />)
    expect(view.getByTitle('.env').textContent).toContain('ENV 3B')
  })
})

describe('folder drops', () => {
  it('inserts the path a drop disclosed as a file URL', () => {
    const onDropPaths = vi.fn()
    render(<ComposerAttachments {...props({ onDropPaths })} />)
    fireEvent.drop(document.body, {
      dataTransfer: transfer([{ directory: 'src' }], { 'text/uri-list': 'file:///Users/tyza66/project/src\n' }),
    })
    expect(onDropPaths).toHaveBeenCalledWith(['/Users/tyza66/project/src'], [])
  })

  it('keeps a file and a folder from one drop apart', () => {
    const onAddFiles = vi.fn()
    const onDropPaths = vi.fn()
    render(<ComposerAttachments {...props({ onAddFiles, onDropPaths })} />)
    const file = attachment('mixed').file
    fireEvent.drop(document.body, {
      dataTransfer: transfer([{ file }, { directory: 'docs' }], { 'text/plain': '/work/docs' }),
    })
    expect(onAddFiles).toHaveBeenCalledWith([file])
    expect(onDropPaths).toHaveBeenCalledWith(['/work/docs'], [])
  })

  it('prefers the path the engine attached to the dropped entry', () => {
    const onDropPaths = vi.fn()
    render(<ComposerAttachments {...props({ onDropPaths })} />)
    const entryFile = new File([], 'photos')
    Object.defineProperty(entryFile, 'path', { value: '/gateway/photos' })
    fireEvent.drop(document.body, { dataTransfer: transfer([{ file: entryFile, directory: 'photos' }]) })
    expect(onDropPaths).toHaveBeenCalledWith(['/gateway/photos'], [])
  })

  it('names a folder whose path the platform did not disclose', () => {
    const onDropPaths = vi.fn()
    render(<ComposerAttachments {...props({ onDropPaths })} />)
    fireEvent.drop(document.body, { dataTransfer: transfer([{ directory: 'secrets' }]) })
    expect(onDropPaths).toHaveBeenCalledWith([], ['secrets'])
  })

  it('skips a non-file item, a file item without an entry, and an entry without a file', () => {
    const onAddFiles = vi.fn()
    const onDropPaths = vi.fn()
    render(<ComposerAttachments {...props({ onAddFiles, onDropPaths })} />)
    const attached = attachment('kept').file
    fireEvent.drop(document.body, {
      dataTransfer: {
        types: ['Files'],
        files: [],
        items: [
          // A drag that also publishes a string payload.
          { kind: 'string', type: 'text/plain', getAsFile: () => null, webkitGetAsEntry: () => null },
          // An engine that classifies entries but hands back no entry object.
          { kind: 'file', type: 'image/png', getAsFile: () => null, webkitGetAsEntry: () => null },
          // A file entry the engine cannot materialize as a File.
          { kind: 'file', type: 'text/plain', getAsFile: () => null, webkitGetAsEntry: () => ({ isDirectory: false, name: 'ghost.txt' }) },
          // One real file still arrives with the classified batch.
          { kind: 'file', type: 'image/png', getAsFile: () => attached, webkitGetAsEntry: () => ({ isDirectory: false, name: 'kept' }) },
        ],
        dropEffect: 'none',
        getData: () => '',
      },
    })
    expect(onAddFiles).toHaveBeenCalledWith([attached])
    expect(onDropPaths).not.toHaveBeenCalled()
  })

  it('attaches every file of an engine that classifies no entries', () => {
    const onAddFiles = vi.fn()
    const onDropPaths = vi.fn()
    render(<ComposerAttachments {...props({ onAddFiles, onDropPaths })} />)
    const file = attachment('legacy').file
    fireEvent.drop(document.body, {
      // A real DataTransfer always answers getData; an engine that classifies
      // no entries still delivers the file list and discloses no paths.
      dataTransfer: { types: ['Files'], files: [file], items: [], dropEffect: 'none', getData: () => '' },
    })
    expect(onAddFiles).toHaveBeenCalledWith([file])
    expect(onDropPaths).not.toHaveBeenCalled()
  })
})

describe('localPathOf', () => {
  it.each([
    ['file:///Users/tyza66/work', '/Users/tyza66/work'],
    ['file://localhost/Users/tyza66/work', '/Users/tyza66/work'],
    ['file:///C:/work/alpha', 'C:/work/alpha'],
    ['file:///Users/tyza66/my%20work', '/Users/tyza66/my work'],
    ['file:/Users/tyza66/work', '/Users/tyza66/work'],
    ['file:/Users/tyza66/100%work', '/Users/tyza66/100%work'],
    ['  file:///Users/tyza66/work  ', '/Users/tyza66/work'],
    ['/Users/tyza66/work', '/Users/tyza66/work'],
    ['C:\\work\\alpha', 'C:\\work\\alpha'],
  ])('reads %s as %s', (line, expected) => {
    expect(localPathOf(line)).toBe(expected)
  })

  it.each([['https://example.test/a'], ['relative/path'], ['file:relative/path'], [''], ['   ']])('reads no path out of %s', (line) => {
    expect(localPathOf(line)).toBeUndefined()
  })
})
