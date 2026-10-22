/**
 * StateDot's palette as CSS text. jsdom has no layout and CSS Modules resolve
 * to class-name maps in the component suites, so the only place the per-state
 * colors can be read is the stylesheet itself: a state whose rule is missing
 * renders on the inherited color instead of its own, which no render assertion
 * would catch.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/StateDot.module.css', import.meta.url)), 'utf8')

describe('StateDot.module.css', () => {
  it.each(['done', 'warning', 'error', 'idle'] as const)('gives the %s state its own color rule', (state) => {
    expect(css).toContain(`.dot[data-state='${state}']`)
  })

  it('keeps ongoing and paused on the matrix rather than solid-dot rules', () => {
    expect(css).not.toContain(".dot[data-state='ongoing']")
    expect(css).not.toContain(".dot[data-state='paused']")
    expect(css).toContain('@keyframes dsh-state-dot-chase')
  })

  it('holds the paused ring still instead of chasing it', () => {
    // A parked turn keeps the ongoing color at one brightness: live, with
    // nothing progressing.
    expect(css).toMatch(/\.held \.cell \{\s*animation: none;\s*opacity: 0\.55;/)
  })
})
