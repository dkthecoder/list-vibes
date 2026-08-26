/**
 * Swipe the detail panel away.
 *
 * The panel slides in from the right, so on a touch screen the way to get rid
 * of it is to push it back where it came from. Until now the only ways out were
 * the close button, Escape, and the strip of backdrop showing down the left —
 * all of which are fine on a desktop and none of which is the first thing a
 * thumb tries.
 *
 * The decisions are separated from the DOM on purpose. Whether a gesture counts
 * as a swipe, and whether letting go dismisses or springs back, are the parts
 * that are easy to get subtly wrong and impossible to check by looking; the
 * event plumbing around them is not.
 */

/** Movement before a gesture counts as a swipe rather than a stray touch. */
export const SLOP = 12;

/** Vertical movement that ends the matter: this was a scroll, not a swipe. */
export const VERTICAL_GIVE_UP = 16;

/** Fraction of the panel's width that a slow drag has to cross to dismiss. */
export const COMMIT = 0.35;

/** A flick dismisses from anywhere past this, however short. */
export const FLICK_DISTANCE = 32;

/** …provided it was moving at least this fast, in pixels per millisecond. */
export const FLICK_VELOCITY = 0.5;

/**
 * Has this gesture become a swipe?
 *
 * Rightwards only — the panel has nowhere to go leftwards — and the horizontal
 * movement has to clearly beat the vertical, or every slightly-slanted scroll
 * up the panel would start dragging it sideways. The 1.2 is deliberately not
 * 1.0: at parity the two are indistinguishable and the scroll should win,
 * because a scroll interrupted by a swipe is far more annoying than a swipe
 * that needs a moment longer to be believed.
 */
export function beginsSwipe(dx: number, dy: number, slop: number = SLOP): boolean {
	if (dx < slop) return false;
	return dx > Math.abs(dy) * 1.2;
}

/**
 * The gesture is over. Does the panel go, or come back?
 *
 * Two ways to dismiss, because they are two different intentions. Dragging the
 * panel most of the way across is deliberate placement and should not need to
 * be fast. A flick is a short, quick shove that never gets far — judging it by
 * distance alone would ignore it, which is why it gets its own test on speed.
 */
export function settle(
	dx: number,
	width: number,
	elapsedMs: number
): "dismiss" | "return" {
	if (width > 0 && dx >= width * COMMIT) return "dismiss";
	// Guard the division: a zero or negative interval is a clock artefact, not
	// an infinitely fast flick.
	const velocity = elapsedMs > 0 ? dx / elapsedMs : 0;
	if (dx >= FLICK_DISTANCE && velocity >= FLICK_VELOCITY) return "dismiss";
	return "return";
}

/** How far the panel has actually moved, given the finger's displacement. */
export function offsetFor(dx: number, width: number): number {
	if (dx <= 0) return 0;
	// Past its own width the panel is off screen; going further would only make
	// the release animation start from somewhere absurd.
	return width > 0 ? Math.min(dx, width) : dx;
}

/** Fields where a horizontal drag means "move the caret", not "close this". */
function isTextish(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
	if (target.isContentEditable) return true;
	// A slider is horizontal by nature and would otherwise be unusable.
	return !!target.closest("input[type='range'], .slider");
}

export interface SwipeHandle {
	/** Detach every listener. The panel usually outlives nothing, but pins do. */
	destroy(): void;
}

/**
 * Wire the gesture up to a panel.
 *
 * Pointer capture, so that once the swipe is believed the rest of it arrives
 * here even when the finger leaves the panel — which it will, since the whole
 * point is to push the panel out from under it.
 */
export function bindSwipeDismiss(
	panel: HTMLElement,
	backdrop: HTMLElement | null,
	onDismiss: () => void
): SwipeHandle {
	let pointer: number | null = null;
	let startX = 0;
	let startY = 0;
	let startT = 0;
	let dx = 0;
	let dragging = false;

	const width = () => panel.getBoundingClientRect().width;

	const paint = (): void => {
		const w = width();
		const moved = offsetFor(dx, w);
		panel.style.transform = `translateX(${moved}px)`;
		if (backdrop && w > 0) {
			// The backdrop fades in step with the panel, so the list behind it
			// comes back gradually rather than all at once on release.
			backdrop.style.opacity = String(Math.max(0, 1 - moved / w));
		}
	};

	const release = (): void => {
		panel.classList.remove("is-dragging");
		backdrop?.classList.remove("is-dragging");
		// Clearing the inline values hands the panel back to the stylesheet,
		// which animates it from wherever the finger left it.
		panel.style.removeProperty("transform");
		backdrop?.style.removeProperty("opacity");
		pointer = null;
		dragging = false;
		dx = 0;
	};

	const onDown = (e: PointerEvent): void => {
		// A mouse has the close button, Escape and the backdrop; dragging the
		// panel with one would only get in the way of selecting text in it.
		if (e.pointerType === "mouse") return;
		if (panel.classList.contains("is-pinned")) return;
		if (isTextish(e.target)) return;
		pointer = e.pointerId;
		startX = e.clientX;
		startY = e.clientY;
		startT = e.timeStamp;
		dx = 0;
		dragging = false;
	};

	const onMove = (e: PointerEvent): void => {
		if (pointer === null || e.pointerId !== pointer) return;
		const moveX = e.clientX - startX;
		const moveY = e.clientY - startY;

		if (!dragging) {
			if (beginsSwipe(moveX, moveY)) {
				dragging = true;
				panel.setPointerCapture(pointer);
				panel.classList.add("is-dragging");
				backdrop?.classList.add("is-dragging");
			} else if (Math.abs(moveY) > VERTICAL_GIVE_UP) {
				// Committed to a scroll. Stand down for the rest of this touch,
				// rather than waiting to see whether it turns horizontal later.
				pointer = null;
				return;
			} else {
				return;
			}
		}

		dx = moveX;
		paint();
		// Only once the gesture is ours, so a scroll that started here is never
		// swallowed.
		e.preventDefault();
	};

	const onUp = (e: PointerEvent): void => {
		if (pointer === null || e.pointerId !== pointer) return;
		if (!dragging) {
			pointer = null;
			return;
		}
		const verdict = settle(offsetFor(dx, width()), width(), e.timeStamp - startT);
		release();
		if (verdict === "dismiss") {
			// Let the stylesheet slide it the rest of the way out before the
			// view rebuilds, or it would blink out of existence instead.
			panel.classList.remove("is-open");
			backdrop?.classList.remove("is-open");
			// Obsidian augments elements with `.win`, but this module is also
			// exercised outside Obsidian, so the window is found the standard way.
			const view = panel.ownerDocument.defaultView ?? window;
			view.setTimeout(onDismiss, 180);
		}
	};

	const onCancel = (e: PointerEvent): void => {
		if (pointer === null || e.pointerId !== pointer) return;
		release();
	};

	panel.addEventListener("pointerdown", onDown);
	panel.addEventListener("pointermove", onMove);
	panel.addEventListener("pointerup", onUp);
	panel.addEventListener("pointercancel", onCancel);

	return {
		destroy() {
			panel.removeEventListener("pointerdown", onDown);
			panel.removeEventListener("pointermove", onMove);
			panel.removeEventListener("pointerup", onUp);
			panel.removeEventListener("pointercancel", onCancel);
			release();
		},
	};
}
