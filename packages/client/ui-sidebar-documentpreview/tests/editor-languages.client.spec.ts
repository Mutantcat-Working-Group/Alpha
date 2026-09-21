/** Suffix grammars the editor claims, with or without a bundled grammar. */
import { describe, expect, it } from 'vitest'
import { EDITOR_EXTENSIONS, editorLanguageOf } from '../src/client/editor/languages.ts'

describe('editor languages', () => {
  it.each([
    ['source.ts', 'typescript'], ['module.mts', 'typescript'], ['module.cts', 'typescript'],
    ['component.tsx', 'typescript'], ['module.mjs', 'javascript'], ['module.cjs', 'javascript'],
    ['client.jsx', 'javascript'], ['script.sh', 'shell'], ['script.zsh', 'shell'],
    ['data.jsonc', 'json'], ['events.jsonl', 'json'], ['answer.pyw', 'python'],
    ['task.rake', 'ruby'], ['task.gemspec', 'ruby'], ['main.go', 'go'], ['main.rs', 'rust'],
    ['Main.java', 'java'], ['main.c', 'cpp'], ['header.hxx', 'cpp'], ['main.swift', 'swift'],
    ['index.php', 'php'], ['config.yml', 'yaml'], ['config.toml', 'toml'], ['config.ini', 'properties'],
    ['README.md', 'markdown'], ['index.xhtml', 'html'], ['style.scss', 'css'], ['style.less', 'less'],
    ['query.sql', 'sql'], ['schema.xsl', 'xml'], ['init.lua', 'lua'],
  ])('selects the bundled grammar for %s', (path, name) => {
    expect(editorLanguageOf(path)?.language.name).toBe(name)
  })

  it.each(['Main.cs', 'build.kts', 'build.kt', 'page.mdx', 'notes.txt', 'notes.text', 'run.log'])('opens %s without a grammar', (path) => {
    expect(EDITOR_EXTENSIONS).toContain(path.slice(path.lastIndexOf('.') + 1))
    expect(editorLanguageOf(path)).toBeUndefined()
  })

  it('claims each suffix once', () => {
    expect(new Set(EDITOR_EXTENSIONS).size).toBe(EDITOR_EXTENSIONS.length)
  })

  it('uses the filename suffix for both path separators', () => {
    expect(editorLanguageOf('/project/archive.old/source.d.ts')?.language.name).toBe('typescript')
    expect(editorLanguageOf('C:\\project\\source.CPP')?.language.name).toBe('cpp')
  })

  it.each(['README', 'dir.ts/README', 'main.ts.backup', 'file.unknown', 'file.constructor', 'file.__proto__'])('does not claim %s', (path) => {
    expect(editorLanguageOf(path)).toBeUndefined()
  })
})
