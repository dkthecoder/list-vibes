/**
 * Detecting a keyboard that has been subtracted twice.
 *
 * Core shortens the app for the soft keyboard with one rule:
 *
 *     body.is-mobile .app-container { max-height: calc(100vh - var(--keyboard-height)) }
 *
 * That is right when the WebView keeps its full height and the keyboard is drawn
 * over the top of it, which is what Android usually does and what the rule
 * assumes. On some devices the WebView is *also* resized when the keyboard
 * opens — and then `100vh` has already lost the keyboard's height, the variable
 * takes it away a second time, and the app is left `screen - 2 × keyboard` tall.
 *
 * In portrait that reads as the view squashed into the top of the screen with a
 * keyboard's worth of blank below it. In landscape, where the screen is barely
 * two keyboards tall, the result is zero or negative, `max-height` clamps at
 * zero, and the whole app disappears until the keyboard closes.
 *
 * It is a property of the device rather than of any plugin, and it is invisible
 * in Obsidian's own editor for a reason that sends you looking in the wrong
 * place: a shortened editor simply shows fewer lines of text. A fixed layout
 * collapses instead, so this is where it gets noticed.
 *
 * Detected rather than assumed. Reaching over core's own rule is not something
 * to do on a hunch, so it happens only where the viewport can be measured to
 * have shrunk on its own.
 */

export interface Viewport {
	/** `window.innerHeight` right now. */
	innerHeight: number;
	/** The tallest it has been seen with no keyboard up. */
	restingHeight: number;
	/** Core's `--keyboard-height`, in pixels. */
	keyboard: number;
}

/**
 * How much of the keyboard the viewport must have lost by itself before its
 * shrinking is believed.
 *
 * Half, deliberately loosely. A resize on Android rarely equals the keyboard
 * exactly — a navigation bar, a display cutout or a suggestion strip can each
 * account for tens of pixels either way — and the two cases being told apart
 * are "shrank by roughly a keyboard" and "did not shrink at all", which is not
 * a close call.
 */
export const RESIZE_SHARE = 0.5;

export function subtractsTwice({ innerHeight, restingHeight, keyboard }: Viewport): boolean {
	if (!(keyboard > 0)) return false;
	if (!(restingHeight > 0) || !(innerHeight > 0)) return false;
	// A viewport that grew is a rotation, not a keyboard.
	const shrank = restingHeight - innerHeight;
	if (shrank <= 0) return false;
	return shrank >= keyboard * RESIZE_SHARE;
}

/**
 * The tallest the viewport has been with no keyboard up.
 *
 * Kept as a running maximum, and reset by a rotation rather than carried across
 * one: landscape is shorter than portrait, and a resting height remembered from
 * portrait would make every landscape reading look like a shrinking viewport.
 */
export function restingHeightAfter(
	previous: number,
	innerHeight: number,
	keyboard: number,
	rotated: boolean
): number {
	if (rotated) return keyboard > 0 ? 0 : innerHeight;
	if (keyboard > 0) return previous;
	return Math.max(previous, innerHeight);
}
