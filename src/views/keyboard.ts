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

/**
 * Where the bottom of what can actually be seen is, in layout coordinates.
 *
 * Two sources again, for the same reason as the height: on iOS the visual
 * viewport shrinks or slides and reports it honestly; on Android the webview
 * is usually not resized at all, so the visual viewport says the screen is as
 * tall as ever and only the platform's own inset knows better. Taking the
 * higher of the two — the more pessimistic — means the answer is right on both
 * without having to know which platform this is.
 *
 * This being wrong in the Android direction is why an earlier version did
 * nothing there: the visual viewport reported a full-height screen, so the view
 * looked like it fitted, and the browser went on scrolling the page to reach
 * the field.
 */
export function visibleBottomOf(opts: {
	innerHeight: number;
	native: number;
	viewportOffsetTop?: number;
	viewportHeight?: number;
}): number {
	const { innerHeight, native, viewportOffsetTop, viewportHeight } = opts;
	const fromViewport =
		Number.isFinite(viewportHeight) && (viewportHeight as number) > 0
			? (viewportOffsetTop ?? 0) + (viewportHeight as number)
			: innerHeight;
	const fromInset = native > 0 ? innerHeight - native : innerHeight;
	return Math.min(fromViewport, fromInset);
}

export interface Fit {
	/** Top of the view, in layout-viewport coordinates. */
	top: number;
	/** Its bottom **with no cap applied** — see below, this matters. */
	bottom: number;
	/** Bottom of the part of the page that is actually on screen. */
	visibleBottom: number;
	/** Sub-pixel rounding is not a fault. */
	slack?: number;
}

/**
 * The height the view has to be capped to in order to stay on screen, or null
 * if it already is.
 *
 * This exists because "the whole screen gets pushed up when the keyboard rises"
 * — which is what a browser does when a focused field is under the keyboard and
 * no scroll container can bring it into view: it gives up and scrolls the page
 * itself, taking the app's own chrome with it and leaving blank space behind.
 *
 * The previous three attempts all tried to prevent that by shortening the view
 * by the keyboard's height. That is wrong whenever Obsidian has already
 * shortened `.app-container` for the same keyboard, because then it is
 * subtracted twice and the pane collapses. So this does not ask how tall the
 * keyboard is at all. It asks whether the view currently extends past the
 * visible area — which is zero when Obsidian has made room, and exactly the
 * shortfall when it has not, with no way to double-count either.
 *
 * The result is an absolute height, not a reduction, and `bottom` must be
 * measured with any previous cap removed. Both together are what make applying
 * it idempotent: capping the view makes its bottom equal `visibleBottom`, and
 * measuring again returns the same number rather than a smaller one. A cap
 * expressed as a delta would shrink the view on every pass.
 */
export function visibleCap({ top, bottom, visibleBottom, slack = 4 }: Fit): number | null {
	if (![top, bottom, visibleBottom].every((n) => Number.isFinite(n))) return null;
	if (bottom <= visibleBottom + slack) return null;

	const cap = Math.floor(visibleBottom - top);
	// A view whose top is already below the fold cannot be rescued by making it
	// shorter, and capping it to nothing would hide what is still visible.
	return cap > 0 ? cap : null;
}
