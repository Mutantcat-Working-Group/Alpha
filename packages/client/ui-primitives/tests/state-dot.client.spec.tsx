// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StateDot } from '@mutantcat/dsh-client-ui-primitives'
import type { StateDotState } from '@mutantcat/dsh-client-ui-primitives'

afterEach(cleanup)

describe('StateDot', () => {
  it.each(['done', 'warning', 'ongoing', 'error', 'idle', 'paused'] as const)('renders state %s as data-state', (state) => {
    const { container } = render(<StateDot state={state} />)
    const dot = container.firstElementChild as HTMLElement
    expect(dot.dataset['state']).toBe(state)
    expect(dot.getAttribute('aria-hidden')).toBe('true')
  })

  it('solid states are spans; ongoing and paused are svg pixel matrices', () => {
    const { container, rerender } = render(<StateDot state="done" />)
    expect(container.firstElementChild?.tagName).toBe('SPAN')
    rerender(<StateDot state="ongoing" />)
    const matrix = container.firstElementChild as SVGSVGElement
    expect(matrix.tagName).toBe('svg')
    const cells = matrix.querySelectorAll('rect')
    expect(cells).toHaveLength(8)
    // Chase phase: every cell carries its own negative animation delay.
    const delays = [...cells].map(cell => (cell).style.animationDelay)
    expect(new Set(delays).size).toBe(8)
  })

  it('paused holds the ring still instead of chasing it', () => {
    const { container } = render(<StateDot state="paused" />)
    const ring = container.firstElementChild as SVGSVGElement
    expect(ring.tagName).toBe('svg')
    expect(ring.querySelectorAll('rect')).toHaveLength(8)
    // Held: no per-cell phase, so every cell shares one static brightness.
    const delays = [...ring.querySelectorAll('rect')].map(cell => cell.style.animationDelay)
    expect(new Set(delays)).toEqual(new Set(['']))
  })

  it('sizes via the size prop in both shapes', () => {
    const { container, rerender } = render(<StateDot state="done" size={12} />)
    const dot = container.firstElementChild as HTMLElement
    expect(dot.style.width).toBe('12px')
    expect(dot.style.height).toBe('12px')
    rerender(<StateDot state="ongoing" size={12} />)
    const ring = container.firstElementChild as SVGSVGElement
    expect(ring.getAttribute('width')).toBe('12')
    expect(ring.getAttribute('height')).toBe('12')
  })

  it('rejects unknown states at the type level', () => {
    const bad = (state: StateDotState) => state
    // @ts-expect-error 'parked' is not one of the six states
    expect(bad('parked')).toBe('parked')
  })
})
