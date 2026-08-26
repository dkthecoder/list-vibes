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
 * Whether a double subtraction already found is still in force.
 *
 * Lifting the cap erases the evidence for it. `capShortfall` measures the gap
 * between the viewport and core's cap, and the override closes that gap by
 * design — so on a device where the custom property cannot be read, the reading
 * that turned the override on reads as zero the moment it is on, the override
 * comes off, and the app flickers between the two states for as long as the
 * keyboard is up.
 *
 * So it is held instead, on the one signal the override does not disturb: the
 * viewport is still shorter than its resting height, which is the WebView's own
 * resize and nothing to do with the cap.
 */
export function stillDoubled(
	previouslyDoubled: boolean,
	innerHeight: number,
	restingHeight: number
): boolean {
	if (!previouslyDoubled) return false;
	if (!(restingHeight > 0) || !(innerHeight > 0)) return false;
	return restingHeight - innerHeight > 2;
}

/**
 * The tallest the viewport has been with no keyboard up.
 *
 * Kept as a running maximum, and reset by a rotation rather than carried across
 * one: landscape is shorter than portrait, and a resting height remembered from
 * portrait would make every landscape reading look like a shrinking viewport.
 */
/**
 * How much shorter than the viewport core has capped the app.
 *
 * The custom property is read where it is *declared*, and that is not
 * guaranteed to be the document element — a value set on `body`, or on
 * `.app-container` itself, reads as nothing from `:root` and the whole
 * detection silently never fires. The cap it produces, on the other hand, is
 * plainly measurable: `max-height` computes to a pixel value whatever
 * `calc(100vh - var(--keyboard-height))` was fed.
 *
 * So this is the same number arrived at from the other end, and it does not
 * care where Obsidian keeps its variable.
 *
 * `maxHeight` is `NaN` when it computes to `none`, which is the resting state.
 */
export function capShortfall(maxHeight: number, innerHeight: number): number {
	if (!Number.isFinite(maxHeight) || maxHeight <= 0) return 0;
	if (!(innerHeight > 0)) return 0;
	const short = innerHeight - maxHeight;
	// Sub-pixel layout rounding is not a keyboard.
	return short > 2 ? short : 0;
}

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
