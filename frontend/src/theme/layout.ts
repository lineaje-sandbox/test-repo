/**
 * Shared layout primitives.
 */

/**
 * A vertical stack built on CSS Grid, safe against intrinsic-width blowout.
 *
 * `display: grid` on its own creates a single implicit `auto` track, and CSS
 * sizes an `auto` track to the widest child's *max-content* width even when the
 * grid container itself has a definite width. A wide child (a data table, a
 * multi-column strip, a long unwrapped heading) therefore pushes the track past
 * the container and scrolls the whole page sideways instead of wrapping.
 *
 * `minmax(0, 1fr)` pins the track to the container: `1fr` caps it at the space
 * available, and the `0` minimum removes the min-content floor so children
 * shrink rather than overflow. Always prefer this over a bare `display: grid`
 * for single-column stacks.
 */
export const stackGrid = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
} as const;

/** Long machine identifiers (order numbers, Minos IDs, VAT IDs) must break, not overflow. */
export const breakAnywhere = {
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
} as const;

/** Wrapper for any table wider than its column: scroll the table, never the page. */
export const scrollX = {
  minWidth: 0,
  maxWidth: '100%',
  overflowX: 'auto',
} as const;
