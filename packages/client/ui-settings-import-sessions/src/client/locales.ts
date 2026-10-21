/** Copy dictionaries for the Harness chat-history import Settings page. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  nav: '导入会话',
  sourceRoot: '来源目录',
  sourceRootHint: '官方 DeepSeek Harness 的 sessions 目录',
  readingSourceRoot: '正在读取来源目录…',
  import: '导入',
  importing: '正在导入…',
  emptyResults: '来源目录中没有会话。',
  results: '导入结果',
  summary: '共处理 {total} 个会话：导入 {imported}，已存在 {alreadyPresent}，拒绝 {refused}。',
  resultSession: '会话 {id}',
  'status.imported': '已导入',
  'status.alreadyPresent': '已存在',
  'status.refused': '已拒绝',
  refusedReason: '原因：{reason}',
  failed: '导入失败：{message}',
} satisfies Record<string, string>

/** Harness-import page locale key union. */
export type ImportSessionsLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  nav: 'Import sessions',
  sourceRoot: 'Source directory',
  sourceRootHint: 'The official DeepSeek Harness sessions directory',
  readingSourceRoot: 'Reading the source directory…',
  import: 'Import',
  importing: 'Importing…',
  emptyResults: 'The source directory holds no sessions.',
  results: 'Import results',
  summary: 'Handled {total} session(s): {imported} imported, {alreadyPresent} already present, {refused} refused.',
  resultSession: 'Session {id}',
  'status.imported': 'Imported',
  'status.alreadyPresent': 'Already present',
  'status.refused': 'Refused',
  refusedReason: 'Reason: {reason}',
  failed: 'Import failed: {message}',
} satisfies Record<ImportSessionsLocaleKey, string>
