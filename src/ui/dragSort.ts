/**
 * Drag to reorder, for task rows and for the steps inside a task.
 *
 * Pointer Events rather than HTML5 drag-and-drop: the latter is unreliable in
 * mobile webviews, gives no usable drag image on touch, and cannot be started
 * from a long press. Pointer Events are one code path for mouse, pen and touch.
 *
 * The two input kinds need genuinely different rules for *starting* a drag:
 *
 * - **Mouse** — a small movement threshold. There is nothing else a vertical
 *   drag on a row could mean, and requiring a wait would feel broken.
 * - **Touch** — a long press. A vertical swipe on a list is a scroll, and it has
 *   to stay one; and inside Obsidian's mobile drawer a horizontal swipe closes
 *   the drawer. Both would be stolen by a threshold-based drag.
 *
 * Once a drag is live the pointer is captured, so the gesture keeps working past
 * the edge of the row and cannot be interrupted by another element.
 */

/** How far the pointer may wander before a long press is treated as a scroll. */
const TOUCH_SLOP = 10;
/** How far a mouse must move before it counts as a drag rather than a click. */
const MOUSE_THRESHOLD = 5;
/** How long to hold on touch before the row becomes draggable. */
const LONG_PRESS_MS = 450;

/**
 * How near the edge of the scroller a live drag starts pulling the list along.
 *
 * Without this a drop target has to already be on screen when the drag starts,
 * which on a phone means it nearly never is: the wall collapses to one column
 * below 560px, so the sections become tall bands and the one being aimed at is
 * usually past the bottom of the screen.
 */
const EDGE = 56;
/** Fastest the list is pulled, in pixels per frame, right at the edge. */
const EDGE_SPEED = 14;

export interface DragSortOptions {
	/** The row's position among its siblings, before any drag. */
	index: number;
	/** The sibling rows, in list order. Read when the drag starts. */
	siblings: () => HTMLElement[];
	/** Called once, on a drop that actually changes the order. */
	onDrop: (from: number, to: number) => void;
	/** Optional grab area. Without one the whole row starts the drag. */
	handle?: HTMLElement;
	/**
	 * Every run the row may be dropped into, this row's own among them, in the
	 * order the view lays them out. Omit it and the drag stays one-dimensional,
	 * which is exactly what a list of steps wants.
	 */
	containers?: () => DragContainer[];
	/** Called instead of `onDrop` when the row lands in a different run. */
	onDropAcross?: (toContainer: number, toIndex: number) => void;
}

/** One run a drag may land in: the element that bounds it, and its rows. */
export interface DragContainer {
	el: HTMLElement;
	rows: HTMLElement[];
}

/**
 * Where a row being dragged should land.
 *
 * `centres` are the sibling row centres in list order, measured before the drag
 * began, and `y` is the pointer. The dragged row is still counted among them,
 * which is what makes a drop on your own row a no-op rather than an off-by-one.
 *
 * Kept pure and exported so the arithmetic can be tested without a browser —
 * off-by-one errors here are invisible in review and obvious in use.
 */
export function dropIndex(centres: number[], from: number, y: number): number {
	if (!centres.length) return from;

	// How many rows the pointer has passed the centre of.
	let passed = 0;
	for (const c of centres) if (c < y) passed++;

	// Dragging downward, the dragged row's own centre is among those passed, so
	// the count overshoots by one. Dragging upward it is not, so the count is
	// already the answer. This is the whole off-by-one, in one line.
	const to = passed > from ? passed - 1 : passed;
	return Math.max(0, Math.min(centres.length - 1, to));
}

/** Just enough of a rect to place something in the flow. */
export interface FlowRect {
	left: number;
	top: number;
	height: number;
}

const centreOf = (r: FlowRect): number => r.top + r.height / 2;

/** The distinct column positions, left to right. Rounded, because a sub-pixel
    difference between two cards in one column is not a second column. */
function columnsOf(rects: FlowRect[]): number[] {
	return [...new Set(rects.map((r) => Math.round(r.left)))].sort((a, b) => a - b);
}

/** Wider than the tallest column, so a later column always outranks an earlier
    one however far down the earlier one runs. */
function columnSpan(rects: FlowRect[]): number {
	const centres = rects.map(centreOf);
	return Math.max(...centres) - Math.min(...centres) + 1;
}

/**
 * Where each element sits along the flow, as one number.
 *
 * `dropIndex` orders by a single value, and on the wall two cards can share a
 * centre *exactly* — a wall of mixed-height cards in columns guarantees it
 * eventually, and one measured on the real thing put cards 6 and 11 both at
 * 5546.46875. A tie makes the count jump by two, and the position between them
 * is then one no pointer can reach.
 *
 * So the column is the first key and the height the second, folded into one
 * ordinate. The arithmetic that consumes it stays one-dimensional and stays
 * right; only the measuring knows there are two dimensions.
 *
 * In rows there is one column and this is the centre it always was.
 */
export function flowOrdinates(rects: FlowRect[]): number[] {
	if (!rects.length) return [];
	const cols = columnsOf(rects);
	if (cols.length < 2) return rects.map(centreOf);

	const span = columnSpan(rects);
	const base = Math.min(...rects.map(centreOf));
	return rects.map(
		(r) => cols.indexOf(Math.round(r.left)) * span + (centreOf(r) - base)
	);
}

/** The pointer's own place in that same flow, so the two can be compared. */
export function flowOrdinate(rects: FlowRect[], x: number, y: number): number {
	if (!rects.length) return y;
	const cols = columnsOf(rects);
	if (cols.length < 2) return y;

	// The last column that starts at or before the pointer; left of them all is
	// the first, which is where a drag that has wandered off the edge belongs.
	let col = 0;
	for (let i = 0; i < cols.length; i++) if (cols[i] <= x) col = i;

	const base = Math.min(...rects.map(centreOf));
	return col * columnSpan(rects) + (y - base);
}

/** A container's bounds, in the same coordinate space as the pointer. */
export interface DropBox {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

/** How far a point sits outside a box. Zero on both axes means inside it. */
function gap(box: DropBox, x: number, y: number): number {
	const dx = Math.max(box.left - x, 0, x - box.right);
	const dy = Math.max(box.top - y, 0, y - box.bottom);
	return dx * dx + dy * dy;
}

/**
 * Which container the pointer is aiming at.
 *
 * `dropIndex` answers where a row lands within one run; this answers which run,
 * and the two compose into a move in two dimensions without either of them
 * having to think in two dimensions.
 *
 * A pointer outside every container falls to the nearest rather than to nothing.
 * Containers do not tile the pane — there are gutters between them, and a band
 * with one card in it is mostly empty space — so "over no container" is a normal
 * position during a drag, not a mistake, and refusing to answer there would make
 * the drop indicator flicker out in the gaps.
 *
 * Kept pure and exported so the arithmetic can be tested without a browser.
 */
export function dropContainer(
	boxes: DropBox[],
	x: number,
	y: number,
	current: number
): number {
	if (!boxes.length) return current;

	let best = 0;
	let bestGap = Infinity;
	for (let i = 0; i < boxes.length; i++) {
		const d = gap(boxes[i], x, y);
		if (d === 0) return i;
		if (d < bestGap) {
			bestGap = d;
			best = i;
		}
	}
	return best;
}

/**
 * How long to keep watching for the click a finished drag leaves behind.
 *
 * A mouse dispatches it immediately after `pointerup`; touch can take a moment.
 * Long enough to catch the straggler, short enough that a real tap afterwards is
 * never the one that gets eaten.
 */
const CLICK_SUPPRESS_MS = 400;

/**
 * Swallow the click that follows a drag.
 *
 * `pointerup` is not the end of the gesture as far as the browser is concerned:
 * it goes on to dispatch `mouseup` and then `click` on the same element. So a
 * row that was dragged into a new position also gets clicked, and a task row's
 * click opens the detail panel — which is why reordering a list popped the
 * editor open, and popped it open *empty*, because the drop had just rewritten
 * the file and the line the panel was told to show had moved.
 *
 * On the document in the capture phase, deliberately. Listeners on the row
 * itself all run in the at-target phase in registration order, so one added here
 * would run *after* the row's own handler and `stopPropagation` would be too
 * late — it would take `stopImmediatePropagation` and an ordering guarantee
 * nobody should depend on. Capturing at the document is simply earlier than the
 * target, whatever the target has registered.
 */
/**
 * How far a row is currently offset, as a number the stylesheet turns into a
 * transform.
 *
 * The transform itself is a fixed rule in CSS; only the distance changes, and
 * that is genuinely per-frame — it follows a finger. A custom property is the
 * seam: the stylesheet still owns what "being dragged" looks like, and this
 * owns how far.
 */
function setOffset(el: HTMLElement, px: number): void {
	el.setCssProps({ "--lv-drag-offset": `${px}px` });
}

function suppressNextClick(el: HTMLElement): void {
	const doc = el.ownerDocument;
	const win = doc.defaultView ?? window;
	let timer = 0;

	const swallow = (e: Event): void => {
		// Only this row's click. Anything else is someone else's tap and is left
		// alone; the timer takes care of standing down.
		const target = e.target;
		if (!(target instanceof Node) || !el.contains(target)) return;
		e.stopPropagation();
		e.preventDefault();
		done();
	};

	const done = (): void => {
		win.clearTimeout(timer);
		doc.removeEventListener("click", swallow, true);
	};

	doc.addEventListener("click", swallow, true);
	timer = win.setTimeout(done, CLICK_SUPPRESS_MS);
}

/** Make one row draggable among its siblings. */
export function makeDragSortable(row: HTMLElement, opts: DragSortOptions): void {
	const grab = opts.handle ?? row;

	// The browser must not claim the gesture for scrolling before we decide
	// whether it is a drag. On the handle we can say so up front; on a whole row
	// we cannot, or the list would stop scrolling entirely.
	if (opts.handle) grab.addClass("lv-grip");



	let startX = 0;
	let startY = 0;
	let pointerId: number | null = null;
	let longPress: number | null = null;
	let live = false;
	let siblings: HTMLElement[] = [];
	let centres: number[] = [];
	let rects: FlowRect[] = [];
	let shiftPx = 0;
	let target = opts.index;
	let groups: DragContainer[] = [];
	let boxes: DropBox[] = [];
	let home = 0;
	let over = 0;
	let lastX = 0;
	let scroller: HTMLElement | null = null;
	let startScroll = 0;
	let edgeFrame = 0;
	let lastY = 0;

	const cancelLongPress = () => {
		if (longPress !== null) {
			window.clearTimeout(longPress);
			longPress = null;
		}
	};

	/* Kept as rects rather than centres: the pointer has to be placed in the
	   same flow as the rows, and that needs their columns as well as their
	   heights. */
	const rectsOf = (els: HTMLElement[]): FlowRect[] =>
		els.map((el) => {
			const r = el.getBoundingClientRect();
			return { left: r.left, top: r.top, height: r.height };
		});

	const begin = () => {
		live = true;

		// The list the row sits in, if it is in one that scrolls.
		scroller = row.closest<HTMLElement>(".lv-scroll");
		startScroll = scroller?.scrollTop ?? 0;

		/*
		 * The pointer is claimed here rather than on pointerdown.
		 *
		 * Capturing it early retargets every later pointer event to this row,
		 * which is exactly what a live drag wants and exactly what a row that is
		 * not being dragged must not do: a name that is renamed by double-click
		 * never sees the second press, because the row swallowed it. Capture is
		 * for a gesture we have decided to take.
		 */
		if (pointerId !== null && !grab.hasPointerCapture(pointerId)) {
			grab.setPointerCapture(pointerId);
		}

		siblings = opts.siblings();

		groups = opts.containers?.() ?? [];
		boxes = groups.map((g) => g.el.getBoundingClientRect());
		home = Math.max(0, groups.findIndex((g) => g.rows === siblings));
		over = home;

		rects = rectsOf(siblings);
		centres = flowOrdinates(rects);
		// Rows are not all the same height — a task with steps is taller than a
		// bare one — so the gap opens by the height of the row being moved, in
		// pixels. A percentage would resolve against each row's own height and
		// leave the preview misaligned exactly where the list is most crowded.
		const self = siblings[opts.index] ?? row;
		const rect = self.getBoundingClientRect();
		const gap = parseFloat(getComputedStyle(self).marginBottom) || 0;
		shiftPx = rect.height + gap;
		target = opts.index;
		row.addClass("lv-dragging");
		document.body.addClass("lv-is-dragging");
	};

	/** Clear every row offset in the home run, for when the pointer leaves it. */
	const settle = () => {
		for (const el of siblings) {
			setOffset(el, 0);
			el.removeClass("lv-shifted");
		}
	};

	/**
	 * How far the list has scrolled since the drag began.
	 *
	 * Every measurement taken at `begin` is in viewport coordinates, and the
	 * list moving underneath the finger invalidates all of them by exactly this
	 * much. Correcting the pointer once is the same as re-measuring everything,
	 * and re-measuring is not available: the preview shifts rows with transforms
	 * and measuring mid-shift feeds the shift back into its own input.
	 */
	const scrolled = (): number => (scroller ? scroller.scrollTop - startScroll : 0);

	/** Pull the list along while the finger is held near its edge. */
	const edgeScroll = () => {
		edgeFrame = 0;
		if (!live || !scroller) return;
		// The row's own window, not this one: a drag inside a popout would
		// otherwise schedule against a window it is not being drawn in.
		const win = row.ownerDocument.defaultView ?? window;

		const r = scroller.getBoundingClientRect();
		let step = 0;
		if (lastY < r.top + EDGE) step = -EDGE_SPEED * Math.min(1, (r.top + EDGE - lastY) / EDGE);
		else if (lastY > r.bottom - EDGE)
			step = EDGE_SPEED * Math.min(1, (lastY - (r.bottom - EDGE)) / EDGE);

		if (step) {
			const before = scroller.scrollTop;
			scroller.scrollTop += step;
			// Keep the preview honest as the list moves under a finger that is
			// not itself moving, which is the whole point of holding at the edge.
			if (scroller.scrollTop !== before) preview(lastX, lastY);
		}
		edgeFrame = win.requestAnimationFrame(edgeScroll);
	};

	const preview = (x: number, y: number) => {
		lastX = x;
		lastY = y;
		if (scroller && !edgeFrame) {
			const win = row.ownerDocument.defaultView ?? window;
			edgeFrame = win.requestAnimationFrame(edgeScroll);
		}

		// Everything below compares against measurements taken before any
		// scrolling, so the pointer is moved into that frame rather than the
		// measurements into this one.
		y += scrolled();
		if (groups.length) {
			const next = dropContainer(boxes, x, y, over);
			if (next !== over) {
				groups[over]?.el.removeClass("lv-drop-target");
				over = next;
				if (over !== home) {
					// Nothing in a foreign run gets shifted: the gap would have to
					// open for a row that is not one of its own, and the run is
					// highlighted instead so the destination is still obvious.
					settle();
					groups[over]?.el.addClass("lv-drop-target");
				}
				target = -1;
			}
			if (over !== home) {
				const rows = groups[over]?.rows ?? [];
				// No index of our own in a foreign run, so nothing is excluded
				// from the count and every row counts as passed or not.
				const theirs = rectsOf(rows);
				target = dropIndex(flowOrdinates(theirs), -1, flowOrdinate(theirs, x, y));
				return;
			}
		}

		const next = dropIndex(centres, opts.index, flowOrdinate(rects, x, y));
		if (next === target) return;
		target = next;
		// Shift the rows the dragged one is passing, so the gap opens where it
		// will land. Transform only — nothing in the DOM moves until the drop, so
		// an abandoned drag has nothing to undo.
		siblings.forEach((el, i) => {
			if (i === opts.index) return;
			let shift = 0;
			if (target > opts.index && i > opts.index && i <= target) shift = -1;
			if (target < opts.index && i >= target && i < opts.index) shift = 1;
			setOffset(el, shift ? shift * shiftPx : 0);
			el.toggleClass("lv-shifted", shift !== 0);
		});
	};

	const finish = (commit: boolean) => {
		cancelLongPress();
		if (pointerId !== null && grab.hasPointerCapture(pointerId)) {
			grab.releasePointerCapture(pointerId);
		}
		pointerId = null;

		if (!live) return;
		live = false;

		if (edgeFrame) (row.ownerDocument.defaultView ?? window).cancelAnimationFrame(edgeFrame);
		edgeFrame = 0;
		scroller = null;

		/*
		 * Whether or not the order changed, and whether or not it was committed.
		 * A gesture that dragged a row is not a tap on it — an abandoned drag
		 * that put the row back where it started should leave the list exactly as
		 * it was, not open the task.
		 */
		suppressNextClick(row);

		row.removeClass("lv-dragging");
		setOffset(row, 0);
		document.body.removeClass("lv-is-dragging");
		settle();
		for (const g of groups) g.el.removeClass("lv-drop-target");

		const across = groups.length > 0 && over !== home;
		groups = [];
		boxes = [];

		if (!commit) return;
		if (across) opts.onDropAcross?.(over, Math.max(0, target));
		else if (target !== opts.index) opts.onDrop(opts.index, target);
	};

	grab.addEventListener("pointerdown", (e: PointerEvent) => {
		// Left button only, and never on a control inside the row.
		if (e.button !== 0) return;
		if (!opts.handle && (e.target as HTMLElement).closest(".lv-no-drag")) return;

		startX = e.clientX;
		startY = e.clientY;
		pointerId = e.pointerId;

		if (e.pointerType === "touch" && !opts.handle) {
			longPress = window.setTimeout(() => {
				longPress = null;
				begin();
			}, LONG_PRESS_MS);
		}
	});

	grab.addEventListener("pointermove", (e: PointerEvent) => {
		if (pointerId !== e.pointerId) return;

		if (!live) {
			// Distance in both axes. A board is dragged sideways as well as up
			// and down, and a horizontal wander during the long press is the
			// mobile drawer being swiped — which must stay the drawer's gesture.
			const moved = Math.hypot(e.clientX - startX, e.clientY - startY);
			if (longPress !== null) {
				// Still waiting out the long press: any real movement means the
				// user is scrolling, so give the gesture back to the browser.
				if (moved > TOUCH_SLOP) finish(false);
				return;
			}
			if (e.pointerType === "touch") return;
			if (moved < MOUSE_THRESHOLD) return;
			begin();
		}

		e.preventDefault();
		setOffset(row, e.clientY - startY);
		preview(e.clientX, e.clientY);
	});

	/*
	 * Take the gesture back once the drag is live.
	 *
	 * `touch-action` cannot do this. It is read when the touch sequence starts,
	 * so a row that says `auto` at the moment a finger lands has already given
	 * the gesture to the browser — and adding `touch-action: none` 450ms later,
	 * when the long press arms, changes nothing about a gesture already under
	 * way. That is why dragging worked on a mouse and never on a phone: the drag
	 * armed, the first move scrolled the list instead, and the pointer was
	 * cancelled out from under it.
	 *
	 * `preventDefault` on a non-passive `touchmove` does work mid-gesture, and
	 * the long press has already ruled out a scroll by cancelling on any wander
	 * over `TOUCH_SLOP` — so by the time this fires, the finger has stayed put
	 * and the browser has not started scrolling anything.
	 *
	 * Nothing here can be seen by the unit tests or the harness: a synthesised
	 * pointer event never engages real scrolling, which is precisely why this
	 * looked fine in every suite for as long as it was broken.
	 */
	grab.addEventListener(
		"touchmove",
		(e: TouchEvent) => {
			if (live) e.preventDefault();
		},
		{ passive: false }
	);

	grab.addEventListener("pointerup", () => finish(true));
	grab.addEventListener("pointercancel", () => finish(false));
	// A drag that ends outside the window would otherwise leave the row stuck
	// mid-flight with the body still in its dragging state.
	grab.addEventListener("lostpointercapture", () => finish(false));

	grab.addEventListener("keydown", (e: KeyboardEvent) => {
		if (e.key === "Escape" && live) {
			e.preventDefault();
			finish(false);
		}
	});
}
