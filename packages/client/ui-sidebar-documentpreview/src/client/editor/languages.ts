/** File suffixes mapped to the CodeMirror grammars this package bundles. */
import { LanguageSupport, StreamLanguage } from '@codemirror/language'
import { cpp } from '@codemirror/lang-cpp'
import { css } from '@codemirror/lang-css'
import { go } from '@codemirror/lang-go'
import { html } from '@codemirror/lang-html'
import { java } from '@codemirror/lang-java'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { less } from '@codemirror/lang-less'
import { markdown } from '@codemirror/lang-markdown'
import { php } from '@codemirror/lang-php'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { lua } from '@codemirror/legacy-modes/mode/lua'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { swift } from '@codemirror/legacy-modes/mode/swift'
import { toml } from '@codemirror/legacy-modes/mode/toml'

// A stream mode is a Language, not a LanguageSupport: the extension slot takes
// the wrapper, so each shared mode is wrapped once.
const shellLanguage = new LanguageSupport(StreamLanguage.define(shell))
const rubyLanguage = new LanguageSupport(StreamLanguage.define(ruby))
const swiftLanguage = new LanguageSupport(StreamLanguage.define(swift))
const tomlLanguage = new LanguageSupport(StreamLanguage.define(toml))
const propertiesLanguage = new LanguageSupport(StreamLanguage.define(properties))
const luaLanguage = new LanguageSupport(StreamLanguage.define(lua))

const grammars = new Map<string, LanguageSupport | undefined>([
  ['ts', javascript({ typescript: true })],
  ['mts', javascript({ typescript: true })],
  ['cts', javascript({ typescript: true })],
  ['tsx', javascript({ typescript: true, jsx: true })],
  ['js', javascript()],
  ['mjs', javascript()],
  ['cjs', javascript()],
  ['jsx', javascript({ jsx: true })],
  ['sh', shellLanguage],
  ['bash', shellLanguage],
  ['zsh', shellLanguage],
  ['json', json()],
  ['jsonc', json()],
  ['jsonl', json()],
  ['ndjson', json()],
  ['py', python()],
  ['pyw', python()],
  ['pyi', python()],
  ['rb', rubyLanguage],
  ['rake', rubyLanguage],
  ['gemspec', rubyLanguage],
  ['go', go()],
  ['rs', rust()],
  ['java', java()],
  ['c', cpp()],
  ['h', cpp()],
  ['cc', cpp()],
  ['cpp', cpp()],
  ['cxx', cpp()],
  ['hh', cpp()],
  ['hpp', cpp()],
  ['hxx', cpp()],
  ['cs', undefined],
  ['kt', undefined],
  ['kts', undefined],
  ['swift', swiftLanguage],
  ['php', php()],
  ['yaml', yaml()],
  ['yml', yaml()],
  ['toml', tomlLanguage],
  ['ini', propertiesLanguage],
  ['md', markdown()],
  ['markdown', markdown()],
  ['mdx', undefined],
  ['html', html()],
  ['htm', html()],
  ['xhtml', html()],
  ['css', css()],
  ['scss', css()],
  ['less', less()],
  ['sql', sql()],
  ['xml', xml()],
  ['xsd', xml()],
  ['xsl', xml()],
  ['xslt', xml()],
  ['lua', luaLanguage],
  ['txt', undefined],
  ['text', undefined],
  ['log', undefined],
])

/** Recognized suffixes: the editor opens each of them, with or without a grammar. */
export const EDITOR_EXTENSIONS: readonly string[] = [...grammars.keys()]

/**
 * Select the CodeMirror grammar for a filename.
 * @param path - decoded source filename or path.
 * @returns the grammar, or undefined for a suffix without one.
 */
export function editorLanguageOf(path: string): LanguageSupport | undefined {
  const extension = /\.([^./]+)$/u.exec(path.replaceAll('\\', '/'))?.[1]?.toLowerCase()
  return extension === undefined ? undefined : grammars.get(extension)
}
