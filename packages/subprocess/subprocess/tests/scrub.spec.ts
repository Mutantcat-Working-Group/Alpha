import { afterEach, describe, expect, it, vi } from 'vitest'
import { scrubbedParentEnv } from '../src/index.ts'
import { DSH_HOME_ENV } from '@mutantcat/dsh-home-paths'

/**
 * The managed-namespace scrub: a child never inherits harness identity
 * implicitly. The home key lives outside the `DSH_` prefix, so the namespace
 * test — not a key list — is what keeps it from reaching a browser-side helper
 * or an SDK-managed transport.
 */
describe('scrubbedParentEnv managed namespaces', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('drops every managed-namespace name, including the built-in home key', () => {
    vi.stubEnv('DSH_SHELL', '1')
    vi.stubEnv('DSH_SESSION_ID', 'session-1')
    vi.stubEnv(DSH_HOME_ENV, '/isolated/alpha-home')
    const env = scrubbedParentEnv()
    expect(env).not.toHaveProperty('DSH_SHELL')
    expect(env).not.toHaveProperty('DSH_SESSION_ID')
    expect(env).not.toHaveProperty(DSH_HOME_ENV)
  })

  it('matches both managed namespaces case-insensitively', () => {
    vi.stubEnv('dsh_shell', '1')
    vi.stubEnv(DSH_HOME_ENV.toLowerCase(), '/isolated/alpha-home')
    const env = scrubbedParentEnv()
    expect(env).not.toHaveProperty('dsh_shell')
    expect(env).not.toHaveProperty(DSH_HOME_ENV.toLowerCase())
  })

  it('keeps the ordinary ambient names a child CLI needs', () => {
    vi.stubEnv('DSH_SHELL', '1')
    const env = scrubbedParentEnv()
    expect(env.PATH).toBe(process.env.PATH)
    expect(env.HOME).toBe(process.env.HOME)
  })

  it('drops credential-shaped names', () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'secret-value')
    expect(scrubbedParentEnv()).not.toHaveProperty('DEEPSEEK_API_KEY')
  })
})
