/** macOS desktop detection for hiddenInset-titlebar layout variants. */

/**
 * Whether the client runs in the macOS desktop shell: the Desktop preload
 * marks `<html>` with `data-platform="darwin"`; plain web never sets it.
 * Read at render time — the mark may arrive as late as DOMContentLoaded.
 * @returns true only inside the macOS Desktop shell.
 */
export function isDarwinDesktop(): boolean {
  return document.documentElement.dataset.platform === 'darwin'
}
