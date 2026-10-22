import clsx from 'clsx'
import css from './StateDot.module.css'

/**
 * State semantic: green done / amber user-attention / blue running ring /
 * red error / grey idle for a tracked subject with nothing in progress /
 * held blue ring for a parked turn that stays open without progressing.
 */
export type StateDotState = 'done' | 'warning' | 'ongoing' | 'error' | 'idle' | 'paused'

/** Outer 3x3 matrix cells (2px pixels on a 10px grid), clockwise from top-left. */
const MATRIX_CELLS: readonly (readonly [number, number])[] = [
  [0, 0], [4, 0], [8, 0], [8, 4], [8, 8], [4, 8], [0, 8], [0, 4],
]

/**
 * Render a state dot.
 * @param props.state - which of `done`, `warning`, `ongoing`, `error`, `idle`, or `paused` to show.
 * @param props.size - outer diameter in px (default 10, the figma size).
 * @param props.className - extra class for layout placement.
 * @returns the dot element (aria-hidden; pair with text for accessibility).
 */
export function StateDot({ state, size = 10, className }: {
  state: StateDotState
  size?: number | undefined
  className?: string | undefined
}) {
  // Ongoing chases its ring; paused holds the same ring still, so a parked
  // turn reads as live without claiming work is progressing.
  if (state === 'ongoing' || state === 'paused') {
    const paused = state === 'paused'
    return (
      <svg
        className={clsx(css.matrix, paused && css.held, className)}
        data-state={state}
        width={size}
        height={size}
        viewBox="0 0 10 10"
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        {MATRIX_CELLS.map(([x, y], index) => (
          <rect
            key={`${x}-${y}`}
            className={css.cell}
            x={x}
            y={y}
            width="2"
            height="2"
            /* Negative delay phases the chase so every cell animates from mount. */
            style={paused ? undefined : { animationDelay: `${(index - MATRIX_CELLS.length) * 125}ms` }}
          />
        ))}
      </svg>
    )
  }
  return (
    <span
      className={clsx(css.dot, className)}
      data-state={state}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  )
}
