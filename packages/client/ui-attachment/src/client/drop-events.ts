/** Document drag-and-drop listeners owned by one mounted attachment view. */
import type { ComposerAttachmentsProps } from '@mutantcat/dsh-client-ui-conversation/client'

/** One dropped batch, split by what the composer can do with each member. */
export interface DroppedBatch {
  /** Regular files for attachment intake. */
  readonly files: readonly File[]
  /** Folder paths the drop disclosed, for insertion into the draft. */
  readonly folderPaths: readonly string[]
  /** Dropped folders the platform disclosed no path for. */
  readonly unresolvedFolders: readonly string[]
}

/** `file:` URL scheme prefix a dropped item's path arrives under. */
const FILE_URL_PREFIX = 'file:'

/** Absolute path spelling: POSIX root or a Windows drive. */
const ABSOLUTE_PATH_RE = /^(?:\/|[A-Za-z]:[\\/])/

/**
 * Decode one percent-escaped component, keeping the input when it is malformed.
 * @param value - URL text that may contain escape sequences.
 * @returns the decoded text.
 */
function decodeEscapes(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    // A partially escaped path is still the best path the drop disclosed.
    return value
  }
}

/**
 * Read the local path one line of a drop's text payload names, either as a
 * `file:` URL or as an absolute path written out plainly.
 * @param value - one line of a drop's text payload.
 * @returns the path, or `undefined` when the line names none.
 */
export function localPathOf(value: string): string | undefined {
  const line = value.trim()
  if (!line.startsWith(FILE_URL_PREFIX)) return ABSOLUTE_PATH_RE.test(line) ? line : undefined
  const rest = decodeEscapes(line.slice(FILE_URL_PREFIX.length))
  if (!rest.startsWith('//')) return rest.startsWith('/') ? rest : undefined
  const afterScheme = rest.slice(2)
  // An empty authority means the URL is `file:///absolute/path`.
  const path = afterScheme.startsWith('/') ? afterScheme : `/${afterScheme.slice(afterScheme.indexOf('/') + 1)}`
  // Windows drive letters are spelled without the URL's leading slash.
  return /^\/[A-Za-z]:[\\/]/.test(path) ? path.slice(1) : path
}

/**
 * Read the local paths a drop disclosed through its text payloads.
 * @param dataTransfer - the drop's transfer.
 * @returns the disclosed paths in payload order, without duplicates.
 */
function disclosedPaths(dataTransfer: DataTransfer): string[] {
  const payloads = [dataTransfer.getData('text/uri-list'), dataTransfer.getData('text/plain')]
  const paths = payloads
    .flatMap(payload => payload.split(/\r?\n/))
    .map(localPathOf)
    .filter((path): path is string => path !== undefined)
  return [...new Set(paths)]
}

/**
 * The trailing name of a path, compared across both separator spellings.
 * @param path - absolute path.
 * @returns its final component.
 */
function trailingName(path: string): string {
  /* v8 ignore next -- split always yields at least one component, so `at(-1)` is never undefined for a string. */
  return path.split(/[\\/]/).at(-1) ?? path
}

/**
 * The absolute path an engine attaches to a dropped entry's file as a
 * non-standard `path` property (the desktop webview and Electron both do).
 * @param file - the entry's file, when the drop produced one.
 * @returns the path, or `undefined` when the engine discloses none.
 */
function entryFilePath(file: File | null): string | undefined {
  const path: unknown = file === null ? undefined : Reflect.get(file, 'path')
  return typeof path === 'string' && path.length > 0 ? path : undefined
}

/**
 * Remove and return the first disclosed path whose trailing name matches.
 * @param disclosed - remaining disclosed paths, consumed in place.
 * @param name - the dropped entry's name.
 * @returns the matching path, or `undefined` when none disclosed that name.
 */
function takeTrailing(disclosed: string[], name: string): string | undefined {
  const index = disclosed.findIndex(candidate => trailingName(candidate) === name)
  return index === -1 ? undefined : disclosed.splice(index, 1)[0]
}

/**
 * Classify one drop into attachable files, resolvable folder paths, and folders
 * the platform left nameless.
 *
 * A folder is a directory entry, not a file: attaching it would upload nothing,
 * so the composer inserts its path instead. Browsers disclose that path only
 * through the drop's text payloads (or a non-standard `path` on the entry's
 * file), which is why an unresolved folder is reported rather than guessed.
 * @param dataTransfer - the drop's transfer.
 * @returns the classified batch.
 */
export function readDrop(dataTransfer: DataTransfer): DroppedBatch {
  const files: File[] = []
  const folders: { name: string; file: File | null }[] = []
  let classifiedEntries = false
  for (const item of dataTransfer.items) {
    if (item.kind !== 'file') continue
    const entry = item.webkitGetAsEntry()
    if (entry === null) continue
    classifiedEntries = true
    const file = item.getAsFile()
    if (entry.isDirectory) {
      folders.push({ name: entry.name, file })
      continue
    }
    if (file !== null) files.push(file)
  }
  // An engine without entry support still delivers the file list.
  if (!classifiedEntries) files.push(...dataTransfer.files)
  const disclosed = disclosedPaths(dataTransfer)
  const folderPaths: string[] = []
  const unresolvedFolders: string[] = []
  for (const folder of folders) {
    const disclosedPath = entryFilePath(folder.file) ?? takeTrailing(disclosed, folder.name)
    if (disclosedPath === undefined) unresolvedFolders.push(folder.name)
    else folderPaths.push(disclosedPath)
  }
  return { files, folderPaths, unresolvedFolders }
}

/**
 * Install one attachment view's file-drop listeners.
 * @param canAcceptDrop - whether this view accepts the dropped files.
 * @param onAddFiles - attachment intake callback.
 * @param onDropPaths - folder-path intake callback.
 * @param dragDepth - the view's retained nested-drag counter.
 * @param setDragActive - publish whether a file drag is active.
 * @returns cleanup for exactly these listeners.
 */
export function installDocumentDropEvents(
  canAcceptDrop: ComposerAttachmentsProps['canAcceptDrop'],
  onAddFiles: ComposerAttachmentsProps['onAddFiles'],
  onDropPaths: ComposerAttachmentsProps['onDropPaths'],
  dragDepth: { current: number },
  setDragActive: (active: boolean) => void,
): () => void {
  const fileTransfer = (event: globalThis.DragEvent): DataTransfer | null => {
    const dataTransfer = event.dataTransfer
    if (dataTransfer === null || !dataTransfer.types.includes('Files')) return null
    return dataTransfer
  }
  const reset = (): void => {
    dragDepth.current = 0
    setDragActive(false)
  }
  const onDragEnter = (event: globalThis.DragEvent): void => {
    if (fileTransfer(event) === null) return
    event.preventDefault()
    dragDepth.current += 1
    setDragActive(true)
  }
  const onDragOver = (event: globalThis.DragEvent): void => {
    const dataTransfer = fileTransfer(event)
    if (dataTransfer === null) return
    event.preventDefault()
    dataTransfer.dropEffect = canAcceptDrop ? 'copy' : 'none'
  }
  const onDragLeave = (event: globalThis.DragEvent): void => {
    if (fileTransfer(event) === null) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragActive(false)
    const leftViewport = event.clientX <= 0 || event.clientY <= 0
      || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight
    if ((event.target === document.documentElement || event.target === document.body) && leftViewport) reset()
  }
  const onDrop = (event: globalThis.DragEvent): void => {
    const dataTransfer = fileTransfer(event)
    if (dataTransfer === null) return
    event.preventDefault()
    reset()
    const batch = readDrop(dataTransfer)
    if (canAcceptDrop && batch.files.length > 0) onAddFiles([...batch.files])
    if (batch.folderPaths.length > 0 || batch.unresolvedFolders.length > 0) {
      onDropPaths(batch.folderPaths, batch.unresolvedFolders)
    }
  }
  document.addEventListener('dragenter', onDragEnter)
  document.addEventListener('dragover', onDragOver)
  document.addEventListener('dragleave', onDragLeave)
  document.addEventListener('drop', onDrop)
  window.addEventListener('dragend', reset)
  return () => {
    document.removeEventListener('dragenter', onDragEnter)
    document.removeEventListener('dragover', onDragOver)
    document.removeEventListener('dragleave', onDragLeave)
    document.removeEventListener('drop', onDrop)
    window.removeEventListener('dragend', reset)
  }
}
