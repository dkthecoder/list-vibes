/**
 * Boxes that can be scrolled but never scrolled back.
 *
 * An `overflow: hidden` element is still a scroll container — it merely has no
 * scrollbar. So when the keyboard covers a focused input, the browser walks up
 * the ancestors looking for something it can scroll to reveal the field, and an
 * `overflow: hidden` ancestor answers yes. Everything inside it slides up
 * together, and with no scrollbar there is no way back until the keyboard closes
 * and the overflow disappears.
 *
 * Which ancestor answers decides how much disappears. `.view-content` takes a
 * plugin's view with it. `.app-container` takes Obsidian's own header and
 * navigation bar too — which is a whole screen going blank.
 *
 * Split out from the view because the *chain* is the part worth testing: naming
 * two boxes by hand left every other link in it unguarded, and the difference
 * between guarding two and guarding all of them is invisible until a device
 * shows it.
 */

/** True for a box that can hold a scroll offset the user cannot undo. */
export function isUnscrollable(style: { overflowX: string; overflowY: string }): boolean {
	const stuck = (v: string) => v === "hidden" || v === "clip";
	return stuck(style.overflowY) || stuck(style.overflowX);
}

/**
 * Every ancestor of `el` — itself included — that could hold such an offset,
 * from the innermost outwards, plus the document body.
 *
 * The body is included unconditionally: core pins `documentElement` at startup
 * and nothing pins the body, and its computed overflow says `visible` right up
 * until something scrolls it.
 */
export function unscrollableAncestors(el: HTMLElement, win: Window): HTMLElement[] {
	const found: HTMLElement[] = [];
	let node: HTMLElement | null = el;
	while (node) {
		if (isUnscrollable(win.getComputedStyle(node))) found.push(node);
		node = node.parentElement;
	}
	const body = el.ownerDocument.body;
	if (body && !found.includes(body)) found.push(body);
	return found;
}

/**
 * Put a box back to the top left if something moved it, and say whether it had.
 *
 * Safe precisely because these boxes have no scrollbar: an offset nobody can see
 * and nobody can undo is never one they asked for. It is the guard core already
 * runs on the document root, applied one level down.
 */
export function resetIfScrolled(el: HTMLElement): boolean {
	if (el.scrollTop === 0 && el.scrollLeft === 0) return false;
	el.scrollTop = 0;
	el.scrollLeft = 0;
	return true;
}
