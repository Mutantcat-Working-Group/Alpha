/** The user-facing failure-code taxonomy: membership is the whole contract. */

import { describe, expect, it } from 'vitest'
import { isLlmFailureCode, LLM_FAILURE_CODES } from '../src/error.ts'

describe('isLlmFailureCode', () => {
  it('accepts a listed code and rejects anything outside the taxonomy', () => {
    for (const code of LLM_FAILURE_CODES) expect(isLlmFailureCode(code)).toBe(true)
    expect(isLlmFailureCode('HTTP_500')).toBe(false)
    expect(isLlmFailureCode('')).toBe(false)
    expect(isLlmFailureCode(undefined)).toBe(false)
    expect(isLlmFailureCode(42)).toBe(false)
    expect(isLlmFailureCode({ code: 'AUTH' })).toBe(false)
  })
})
