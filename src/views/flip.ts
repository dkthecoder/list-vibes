/**
 * Making a reordered row look like it travelled.
 *
 * A scoped repaint replaces the pane, so a row that changed place simply appears
 * in its new spot. Starring a task is the clearest case: with the starred band on,
 * the row leaves its group for the top of the list and the only thing the eye gets
 * is a teleport. Sort changes, unstarring and a task moving between groups all do
 * the same.
 *
 * The cure is the standard one — let the browser lay out the final state, then
 * transform each row back to where it used to be and release it on the next frame,
 * so it slides from the old position to the new. Only `transform` changes, which
 * never costs a reflow, and the rows are already being measured for the scroll
 * anchor so the positions come for free.
 *
 * The sums are here; applying them is in scrollAnchor, next to the measuring.
 */

// Type-only, so the pairing with scrollAnchor leaves no import cycle at runtime.
import type { RowPos } from "./scrollAnchor";

/** Below this, a slide is not worth a transition — or a repaint to start it. */
export const MIN_SHIFT_PX = 1;

/**
 * How long a row takes to travel, and on what curve.
 *
 * The same 160ms and easing `.lv-sortable` uses for rows getting out of the way
 * during a drag, so a row that moves because it was starred moves the way a row
 * that moves because it was dragged does.
 */
export const FLIP_MS = 160;
export const FLIP_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

/** How far past each edge of the scroller is still worth animating. */
export const FLIP_MARGIN_PX = 120;

export interface Shift {
	key: string;
	/**
	 * How far to push the row to put it back where it was.
	 *
	 * A row that moved *up* gets a positive `dy`, because it has to be sent back
	 * down to its old place before being let go.
	 */
	dy: number;
}

/**
 * Rows that are in both paints and changed place.
 *
 * A row that only existed before has gone, and a row that only exists now has
 * nowhere to come from — neither can slide, so neither is listed. What is left is
 * exactly the set that moved while staying on screen.
 */
export function rowShifts(before: RowPos[], after: RowPos[], minPx = MIN_SHIFT_PX): Shift[] {
	const was = new Map(before.map((r) => [r.key, r.top]));
	const out: Shift[] = [];
	for (const row of after) {
		const top = was.get(row.key);
		if (top === undefined) continue;
		const dy = top - row.top;
		if (Math.abs(dy) < minPx) continue;
		out.push({ key: row.key, dy });
	}
	return out;
}

/**
 * The same rows, placed against what is on screen instead of against the content.
 *
 * This is the frame the slide has to be measured in. The scroll anchor moves the
 * scroller to hold the reader's row still when something above it changes height,
 * so in content space that row moved while on screen it did not — and measuring
 * there would animate a slide for a row the eye saw standing perfectly still.
 */
export function toViewport(rows: RowPos[], scrollTop: number): RowPos[] {
	return rows.map((r) => ({ ...r, top: r.top - scrollTop }));
}

/**
 * The rows close enough to the visible window to be worth animating.
 *
 * A row 400px off the end of a long list slides where nobody is looking, and a
 * list of several hundred would otherwise transform every one of them. The margin
 * reaches past both edges so that a row scrolled into part way through is already
 * in flight rather than snapping into place.
 */
export function nearViewport(
	rows: RowPos[],
	scrollTop: number,
	viewport: number,
	margin: number
): RowPos[] {
	const top = scrollTop - margin;
	const bottom = scrollTop + viewport + margin;
	return rows.filter((r) => r.top + r.height > top && r.top < bottom);
}
