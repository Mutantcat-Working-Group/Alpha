/** Editor renderer copy: the implementation name, read progress, and save outcomes. */
import type {} from '@mutantcat/dsh-client-ui-slots'

declare module '@mutantcat/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Editor implementation name, loading, saving, and failure copy. */
    sidebarEditor: keyof typeof zh
  }
}

/** Simplified Chinese dictionary and key source. */
export const zh = {
  title: '编辑器',
  loading: '正在读取…',
  retry: '重试',
  unavailable: '编辑器暂不可用：无法连接到运行 Alpha 的主机。',
  changed: '文件在读取过程中已更改，请重试',
  save: '保存',
  saving: '保存中…',
  discard: '放弃修改并重新载入',
  'error.staleVersion': '文件已被其他修改覆盖，请重新载入后再保存',
  'error.sandboxDenied': '当前工作区不允许写入此文件',
  'error.writeFailed': '写入失败：{message}',
} satisfies Record<string, string>

/** Editor dictionary key union. */
export type SidebarEditorKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  title: 'Editor',
  loading: 'Reading…',
  retry: 'Retry',
  unavailable: 'The editor is unavailable: no connection to the computer running Alpha.',
  changed: 'The file changed while it was being read. Try again.',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard changes and reload',
  'error.staleVersion': 'The file was changed elsewhere. Reload it before saving again.',
  'error.sandboxDenied': 'The workspace policy does not allow writing this file.',
  'error.writeFailed': 'Write failed: {message}',
} satisfies Record<SidebarEditorKey, string>
