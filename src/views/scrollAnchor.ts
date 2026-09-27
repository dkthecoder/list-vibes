import {
	FLIP_EASING,
	FLIP_MARGIN_PX,
	FLIP_MS,
	nearViewport,
	rowShifts,
	toViewport,
} from "./flip";

/**
 * Keeping a scroller still across a repaint that changes what is above it.
 *
 * A scoped repaint replaces a pane wholesale, so the scroll offset has to be
 * carried over by hand. Carrying the raw pixel offset is only right when nothing
 * above the viewport changed height — and completing a task always changes it,
 * because the row leaves the active list for the completed section. Restoring
 * the old number then shows different content, or gets clamped toward the top
 * when the list has grown shorter than the offset.
 *
 * So the offset is remembered against a row instead. Whatever happens above it,
 * that row goes back where the eye last had it.
 */

export interface RowPos {
	key: string;
	top: number;
	height: number;
}

export interface Anchor {
	key: string;
	/** Where the row sat relative to the scroller's top edge. Negative when partly above it. */
	offset: number;
}

/**
 * The topmost row still on screen, and where it sat.
 *
 * The first row whose bottom edge has not yet passed the top of the viewport —
 * which is the partly-visible one when the scroll sits mid-row, and that is the
 * right choice: it is the row the reader's eye is anchored to. Falls back to the
 * last row when the scroll is past all of them, so a scroller that has been
 * over-scrolled still has something to hold on to.
 */
export function pickAnchor(rows: RowPos[], scrollTop: number): Anchor | null {
	if (rows.length === 0) return null;
	const hit = rows.find((r) => r.top + r.height > scrollTop) ?? rows[rows.length - 1];
	return { key: hit.key, offset: hit.top - scrollTop };
}

/**
 * Where the scroller has to sit to put the anchor row back at its old offset.
 *
 * Clamped at zero rather than left negative: the browser would clamp it anyway,
 * silently, and a caller comparing what it asked for against what it got would
 * see a difference it did not cause.
 */
export function anchoredScrollTop(anchor: Anchor, top: number): number {
	return Math.max(0, top - anchor.offset);
}

/**
 * Every identified row's place in the scroller's own content space.
 *
 * Measured off the rects rather than `offsetTop`, which is relative to whichever
 * ancestor happens to be positioned and not to the scroller. The reads are done
 * in one pass with no writes between them, so the browser lays out once.
 */
function rowPositions(scroller: HTMLElement): RowPos[] {
	const box = scroller.getBoundingClientRect();
	const top = scroller.scrollTop;
	const out: RowPos[] = [];
	for (const row of Array.from(scroller.querySelectorAll<HTMLElement>("[data-lv-key]"))) {
		const r = row.getBoundingClientRect();
		out.push({ key: row.dataset.lvKey ?? "", top: r.top - box.top + top, height: r.height });
	}
	return out;
}

/**
 * Replace a pane, leaving the scroller looking at what it was looking at.
 *
 * Carrying the raw pixel offset across is only right when nothing above the
 * viewport changed height, and the commonest repaint of all — a task being
 * ticked — changes it: the row leaves the open list for the completed section.
 * The old offset then shows different content, or gets clamped toward the top
 * when the list has become shorter than it, which walks the view upwards a row
 * at a time. So the offset is carried against a row instead, and the pixel
 * number is only the fallback for when that row has gone too.
 */
/** The identified rows of a scroller, by key, for handing a shift to. */
function rowElements(scroller: HTMLElement): Map<string, HTMLElement> {
	const out = new Map<string, HTMLElement>();
	for (const row of Array.from(scroller.querySelectorAll<HTMLElement>("[data-lv-key]"))) {
		out.set(row.dataset.lvKey ?? "", row);
	}
	return out;
}

/**
 * Slide every row that changed place, instead of letting it appear there.
 *
 * Each row is animated *from* where it used to be to where it now is, which is
 * why nothing has to be held back: the layout is already final and only the
 * transform is a lie, so a repaint arriving mid-slide replaces the row and the
 * next swap simply animates from wherever it had got to.
 *
 * Four things are left out of it:
 *
 * - **Reduced motion.** Nothing moves, as with the confetti and the grace period.
 * - **A drag in progress**, which owns the transforms on these rows itself and
 *   would fight for them.
 * - **A row already leaving**, which is running its own fade and collapse.
 * - **Rows away from the viewport**, which would slide where nobody is looking.
 */
function slideMovedRows(
	sc: HTMLElement,
	before: RowPos[],
	after: RowPos[],
	wasScrolledTo: number
): void {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	if (document.body.classList.contains("lv-is-dragging")) return;

	/*
	 * Both paints placed against the screen rather than the content, because the
	 * anchor above has just moved the scroller to hold one row still. Measured in
	 * content space, that row would look as though it had travelled and be given a
	 * slide for a journey the eye never saw it make.
	 */
	const wasSeen = toViewport(before, wasScrolledTo);
	const isSeen = toViewport(after, sc.scrollTop);

	const onScreen = nearViewport(isSeen, 0, sc.clientHeight, FLIP_MARGIN_PX);
	const shifts = rowShifts(wasSeen, onScreen);
	if (!shifts.length) return;

	const els = rowElements(sc);
	for (const shift of shifts) {
		const row = els.get(shift.key);
		if (!row || row.classList.contains("is-leaving")) continue;
		row.animate(
			[{ transform: `translateY(${shift.dy}px)` }, { transform: "translateY(0)" }],
			{ duration: FLIP_MS, easing: FLIP_EASING }
		);
	}
}

export function swapPane(el: HTMLElement, render: (parent: HTMLElement) => void): HTMLElement {
	const scrolled = el.querySelector<HTMLElement>(".lv-scroll, .lv-nav-scroll");
	const keep = scrolled ? scrolled.scrollTop : 0;
	const before = scrolled ? rowPositions(scrolled) : [];
	/*
	 * Nothing to anchor to at the very top. There is no content above the viewport
	 * for a height change to have happened in, so the only thing following a row
	 * could do is scroll a list that reordered itself — which would take the first
	 * row out of sight when the top two swap. Chromium's own scroll anchoring
	 * declines at offset zero on the same reasoning.
	 */
	const anchor = scrolled && keep > 0 ? pickAnchor(before, keep) : null;

	const holder = createDiv();
	render(holder);
	const next = holder.firstElementChild as HTMLElement | null;
	if (!next) return el;

	el.replaceWith(next);
	const sc = next.querySelector<HTMLElement>(".lv-scroll, .lv-nav-scroll");
	if (!sc) return next;

	// Content-space, so the same measurements serve the anchor and the slides.
	const after = rowPositions(sc);
	const again = anchor ? after.find((r) => r.key === anchor.key) : undefined;
	if (anchor && again) sc.scrollTop = anchoredScrollTop(anchor, again.top);
	else if (keep) sc.scrollTop = keep;

	// After the scroll is settled, so what counts as on screen is the truth.
	slideMovedRows(sc, before, after, keep);

	return next;
}
