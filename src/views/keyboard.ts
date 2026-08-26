/**
 * How much of the view the soft keyboard is covering.
 *
 * There is no single answer to ask for. Obsidian's native layer publishes
 * `--keyboard-height`, which is the real inset from the platform but is not
 * documented and is zero on a desktop. The visual viewport is a web standard and
 * reports on iOS, but on Android the webview is usually not resized at all, so
 * it reports nothing. Neither is reliable alone, so both are read and the larger
 * is taken.
 *
 * The arithmetic is separated from the reading of it because it has been wrong
 * three times, in ways no screenshot showed: a number that is merely too large
 * does not look wrong, it looks like the view went blank.
 */

/**
 * The most of a view a keyboard is allowed to be believed to cover.
 *
 * The measurement comes from the whole screen and the view may be a fraction of
 * it — a sidebar, a split, a tablet pane. An unclamped number in that case is
 * not just large, it is meaningless here, and anything laid out from it puts
 * the content past the bottom of a box that cannot scroll far enough to bring
 * it back.
 */
export const MAX_FRACTION = 0.6;

/**
 * Differences smaller than this are browser chrome, not a keyboard.
 *
 * The visual viewport shrinks by a few dozen pixels for an address bar, a
 * find-in-page bar, or a notch, and treating any of those as a keyboard would
 * leave a permanent gap at the bottom of every list.
 */
export const MIN_KEYBOARD = 120;

export interface Reading {
	/** Obsidian's own `--keyboard-height`, in pixels. Zero when unset. */
	native: number;
	/** `innerHeight - visualViewport.height - visualViewport.offsetTop`. */
	visual: number;
	/** The view's own height, which is what the answer has to fit inside. */
	viewHeight: number;
}

export function keyboardOverlap({ native, visual, viewHeight }: Reading): number {
	// A negative reading is a transient during a rotation or an animation, not a
	// negative keyboard.
	const n = Number.isFinite(native) && native > 0 ? native : 0;
	const v = Number.isFinite(visual) && visual >= MIN_KEYBOARD ? visual : 0;
	const measured = Math.max(n, v);
	if (measured <= 0) return 0;

	const room = Number.isFinite(viewHeight) && viewHeight > 0 ? viewHeight : 0;
	if (!room) return Math.round(measured);
	return Math.round(Math.min(measured, room * MAX_FRACTION));
}
