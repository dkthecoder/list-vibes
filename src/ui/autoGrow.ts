/**
 * A field that is as tall as what is in it.
 *
 * The note box was `rows="3"` and the step box a single fixed-height `<input>`,
 * which is two ways of being the wrong size: an empty note reserved three lines
 * of nothing, a long one was squeezed into three with a scrollbar inside it, and
 * a step longer than the field scrolled sideways so you could not read what you
 * had typed. None of that mattered much in an overlay two thirds of a tablet
 * wide. In Obsidian's right panel, which opens around 300px, all of it does.
 *
 * The policy stays in CSS. `min-height` is the resting size and `max-height` is
 * where growing stops and scrolling starts; this only measures the content and
 * applies the result, so a theme or a later change of mind edits a stylesheet
 * rather than this file.
 */

/**
 * The height a field should take: what its content wants, held between the two
 * bounds its stylesheet set.
 */
export function clampHeight(content: number, min: number, max: number): number {
	// A field that has not been laid out yet reports nothing. Its resting size
	// is the honest answer, not zero.
	if (!(content > 0)) return min > 0 ? min : 0;
	const floor = min > 0 ? min : 0;
	const ceiling = Number.isFinite(max) && max > 0 ? max : Infinity;
	return Math.min(Math.max(content, floor), ceiling);
}

/** True when the content did not fit, so the field has to scroll after all. */
export function overflows(content: number, applied: number): boolean {
	// A pixel of slack: `scrollHeight` is rounded and a sub-pixel line height
	// otherwise leaves a scrollbar on a field that visibly fits.
	return content > applied + 1;
}

interface Sizable {
	setCssProps(props: Record<string, string>): void;
	scrollHeight: number;
}

/**
 * Measure one field and size it. Exported so a caller can re-run it after
 * setting `value` from code, which fires no `input` event.
 */
export function sizeToContent(
	el: Sizable,
	bounds: { min: number; max: number }
): void {
	/*
	 * The height goes through a custom property rather than `style.height`, so
	 * the stylesheet still owns the rule — `height: var(--lv-grow-height, auto)`
	 * — and this only supplies the number. It is the same seam the drag offset
	 * uses: CSS decides what a field looks like, JS measures how tall its
	 * content is, and neither has an opinion about the other.
	 *
	 * Released to `auto` before measuring, or `scrollHeight` reports the height
	 * already set instead of the height wanted, and a field that has grown can
	 * never shrink again when text is deleted.
	 */
	el.setCssProps({ "--lv-grow-height": "auto" });
	const wanted = el.scrollHeight;
	const applied = clampHeight(wanted, bounds.min, bounds.max);
	el.setCssProps({
		"--lv-grow-height": `${applied}px`,
		"--lv-grow-overflow": overflows(wanted, applied) ? "auto" : "hidden",
	});
}

/**
 * The window a field lives in, by the standard route.
 *
 * Not `el.win`, which is Obsidian's augmentation of the DOM and does not exist
 * in the browser harness — so a field bound through it threw on every paint
 * there while working perfectly in the app. Plain DOM is what both have.
 */
function viewOf(el: Element): Window {
	return el.ownerDocument.defaultView ?? window;
}

/** The bounds a field's own stylesheet gives it. */
export function boundsOf(el: HTMLElement): { min: number; max: number } {
	const cs = viewOf(el).getComputedStyle(el);
	return {
		min: parseFloat(cs.minHeight) || 0,
		max: parseFloat(cs.maxHeight) || Infinity,
	};
}

/** Keep a textarea sized to its content for as long as it exists. */
export function autoGrow(el: HTMLTextAreaElement): void {
	const measure = () => {
		sizeToContent(el, boundsOf(el));
	};
	el.addEventListener("input", measure);
	// The value is often set from code straight after this, and code does not
	// fire `input`; a frame's delay costs nothing and catches both.
	measure();
	viewOf(el).requestAnimationFrame(measure);
}
