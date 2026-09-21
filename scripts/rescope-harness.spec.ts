/** The codemod's guards and residue scan stay exact, so the mapping cannot silently widen. */

import { describe, expect, it } from 'vitest'
import { legacyResidue, rewriteLine } from './rescope-harness.ts'

describe('rewriteLine', () => {
  it('moves repository packages between the two scopes', () => {
    expect(rewriteLine("import { x } from '@deepseek-ai/dsh-session'", 'x.ts', 1, false).text)
      .toBe("import { x } from '@mutantcat/dsh-session'")
    expect(rewriteLine("import { x } from '@mutantcat/dsh-session'", 'x.ts', 1, true).text)
      .toBe("import { x } from '@deepseek-ai/dsh-session'")
  })

  it('keeps the external LibreOffice engine on its registry scope', () => {
    const line = "import { convert } from '@deepseek-ai/libreoffice-kit'"
    expect(rewriteLine(line, 'x.ts', 1, false)).toEqual({ text: line, replaced: 0 })
  })

  it('skips a guarded legacy-compat line', () => {
    const line = "const LEGACY_SCOPE = '@deepseek-ai'"
    expect(rewriteLine(line, 'scripts/gen-tsconfig-paths.ts', 40, false).text).toBe(line)
  })
})

describe('legacyResidue', () => {
  it('reports non-external tokens but not the region or engine rows', () => {
    const content = [
      "import engine from '@deepseek-ai/libreoffice-kit'",
      "import current from '@mutantcat/dsh-session'",
      "import old from '@deepseek-ai/dsh-session'",
      '      // Pre-rescope names, kept resolvable for plugins published against them.',
      '      "@deepseek-ai/cordis": ["./vendor/cordis/src"],',
      '      // END generated package aliases',
    ].join('\n')
    expect(legacyResidue('fake.ts', content)).toEqual([
      { line: 3, text: "import old from '@deepseek-ai/dsh-session'" },
    ])
  })

  it('finds no residue in the compatibility sites', () => {
    expect(legacyResidue('scripts/gen-tsconfig-paths.ts')).toEqual([])
    expect(legacyResidue('tsconfig.base.json')).toEqual([])
    expect(legacyResidue('apps/desktop/scripts/prepare-dsh.ts')).toEqual([])
  })
})
