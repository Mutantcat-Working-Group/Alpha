/** Recorded npm evidence stays intact while authored files and exact edits remain checked. */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { exactEditState, isRescopeExcluded, listRescopeFiles } from './rescope-vendor.ts'

const ANCHOR = '\n## Sync procedure'
const INSERTED = `\n15. **rescope**: one log entry.\n${ANCHOR}`

describe('rescope file selection', () => {
  it('lists the complete eligible corpus when tracked paths exceed one MiB', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-rescope-paths-'))
    // A Git hook or `git rebase -x` exports these; inherited, they would point the fixture at the caller's repository.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'].includes(key.toUpperCase())))
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: root, env })
      const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: root, env, input: '', encoding: 'utf8' }).trim()
      const paths = Array.from({ length: 12_000 }, (_, i) => `packages/example/src/${String(i).padStart(5, '0')}-${'x'.repeat(80)}.ts`)
      expect(Buffer.byteLength(paths.join('\0'))).toBeGreaterThan(1024 * 1024)
      // Index-only entries exercise Git's complete output without creating thousands of source files.
      const entries = [...paths, 'scripts/dependency-catalog/package-lock.json']
      execFileSync('git', ['update-index', '--index-info'], {
        cwd: root, env, input: entries.map(path => `100644 ${blob}\t${path}\n`).join(''),
      })
      expect(listRescopeFiles(root, env)).toEqual(paths)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('preserves the recorded npm resolution', () => {
    expect(isRescopeExcluded('scripts/dependency-catalog/package-lock.json')).toBe(true)
  })

  it.each([
    'scripts/dependency-catalog/package.json',
    'scripts/dependency-catalog/source.ts',
    'scripts/other/package-lock.json',
    'packages/example/src/index.ts',
    'packages/example/package.json',
  ])('keeps %s subject to upstream package-name checks', (file) => {
    expect(isRescopeExcluded(file)).toBe(false)
  })
})

describe('exactEditState', () => {
  it('classifies an insertion by its target form, so a duplicate is invalid', () => {
    expect(exactEditState(`log\n${ANCHOR}\n`, ANCHOR, INSERTED, 1)).toBe('pending')
    expect(exactEditState(`log${INSERTED}\n`, ANCHOR, INSERTED, 1)).toBe('applied')
    // The anchor survives an insertion, so counting the source form would have
    // called this pending and inserted the entry a second time.
    expect(exactEditState(`log${INSERTED}${INSERTED}\n`, ANCHOR, INSERTED, 1)).toBe('invalid')
    expect(exactEditState('log\n', ANCHOR, INSERTED, 1)).toBe('invalid')
  })

  it('classifies a deletion by its source form, and requires its remainder to survive', () => {
    const remainder = 'exclude:\n'
    const withEntries = 'exclude:\n  - cordis@4\n'
    expect(exactEditState(withEntries, withEntries, remainder, 1)).toBe('pending')
    expect(exactEditState(remainder, withEntries, remainder, 1)).toBe('applied')
    // Upstream dropped the whole field: the source form is gone, but so is the
    // remainder, so this is a moved site rather than a completed deletion.
    expect(exactEditState('unrelated:\n', withEntries, remainder, 1)).toBe('invalid')
  })

  it('requires a replacement to leave no source form and the exact target count', () => {
    expect(exactEditState('a = 1\n', 'a = 1', 'b = 2', 1)).toBe('pending')
    expect(exactEditState('b = 2\n', 'a = 1', 'b = 2', 1)).toBe('applied')
    expect(exactEditState('b = 2\nb = 2\n', 'a = 1', 'b = 2', 1)).toBe('invalid')
    // A moved or partially applied site: neither state is complete.
    expect(exactEditState('a = 1\nb = 2\n', 'a = 1', 'b = 2', 1)).toBe('invalid')
    expect(exactEditState('x\n', 'a = 1', 'b = 2', 1)).toBe('invalid')
  })
})
