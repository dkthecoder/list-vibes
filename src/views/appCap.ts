/**
 * Finding the box a platform rule has shortened, without naming it.
 *
 * The stylesheet ships an override against `body.is-mobile .app-container`,
 * because that is the rule Obsidian is documented to shorten the app with. It
 * has now failed twice on a real tablet while the arithmetic that identified
 * the fault held exactly, which means the premise is what is wrong: either the
 * class never lands, or the cap is not on `.app-container`, or it is not
 * `max-height` that applies it. Three guesses, and guessing is what the last
 * eight rounds were.
 *
 * So this names nothing. It walks up from the view and asks each ancestor a
 * question with a measurable answer — are you much shorter than the viewport
 * you sit in? — and puts the answer back as an inline style, which outranks any
 * stylesheet rule that is not `!important` whatever its selector.
 *
 * It is only ever allowed to run when the viewport has been *observed* to shrink
 * on its own, which is the condition that makes a shortened app wrong rather
 * than right. On a device where the keyboard is drawn over the top of a
 * full-height WebView — the ordinary case, and the one Obsidian's rule is
 * written for — nothing here fires at all.
 */

/**
 * How much shorter than the viewport an ancestor must be before it is believed
 * to have been capped rather than merely laid out.
 *
 * Generous, because the things that legitimately make an ancestor a little
 * shorter — a header, a status bar, a safe-area inset — are tens of pixels, and
 * the thing being looked for is most of a keyboard.
 */
export const MIN_SHORTFALL = 120;

/**
 * Every ancestor of `start`, `start` included, that is materially shorter than
 * the viewport — outermost last.
 *
 * `heightOf` is passed in rather than read here so this can be tested without a
 * browser, and so the harness can drive it with heights it chooses.
 */
export function shortenedAncestors<T>(
	chain: T[],
	heightOf: (el: T) => number,
	viewport: number,
	minShortfall: number = MIN_SHORTFALL
): T[] {
	if (!(viewport > 0)) return [];
	return chain.filter((el) => {
		const h = heightOf(el);
		// A zero height is a collapsed box, which is the worst case of exactly
		// this fault — landscape, where `screen - 2 x keyboard` goes negative and
		// the cap clamps at nothing.
		if (h < 0) return false;
		return viewport - h >= minShortfall;
	});
}

/** The inline values an element had before anything was written over them. */
export interface Restore {
	maxHeight: string;
	height: string;
}

/**
 * Give an element the viewport's full height, keeping whatever it had inline.
 *
 * Both properties, because which one carries the cap is precisely what is not
 * known. Setting a height the element already has costs nothing.
 */
export function uncap(
	el: { style: { maxHeight: string; height: string } },
	viewport: number,
	saved: Map<unknown, Restore>
): void {
	if (!saved.has(el)) {
		saved.set(el, { maxHeight: el.style.maxHeight, height: el.style.height });
	}
	el.style.maxHeight = `${viewport}px`;
	el.style.height = `${viewport}px`;
}

/** Put back exactly what was there, including nothing. */
export function recap(saved: Map<unknown, Restore>): void {
	for (const [el, was] of saved) {
		const styled = el as { style: { maxHeight: string; height: string } };
		styled.style.maxHeight = was.maxHeight;
		styled.style.height = was.height;
	}
	saved.clear();
}
