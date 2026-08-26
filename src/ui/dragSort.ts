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

export interface DragSortOptions {
	/** The row's position among its siblings, before any drag. */
	index: number;
	/** The sibling rows, in list order. Read when the drag starts. */
	siblings: () => HTMLElement[];
	/** Called once, on a drop that actually changes the order. */
	onDrop: (from: number, to: number) => void;
	/** Optional grab area. Without one the whole row starts the drag. */
	handle?: HTMLElement;
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
	// we cannot, or the list would stop scrolling entirely, so `touch-action` is
	// only applied once a long press has actually armed the drag.
	if (opts.handle) grab.style.touchAction = "none";

	let startY = 0;
	let pointerId: number | null = null;
	let longPress: number | null = null;
	let live = false;
	let siblings: HTMLElement[] = [];
	let centres: number[] = [];
	let shiftPx = 0;
	let target = opts.index;

	const cancelLongPress = () => {
		if (longPress !== null) {
			window.clearTimeout(longPress);
			longPress = null;
		}
	};

	const begin = () => {
		live = true;
		siblings = opts.siblings();
		centres = siblings.map((el) => {
			const r = el.getBoundingClientRect();
			return r.top + r.height / 2;
		});
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
		row.style.touchAction = "none";
		document.body.addClass("lv-is-dragging");
	};

	const preview = (y: number) => {
		const next = dropIndex(centres, opts.index, y);
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
			el.style.transform = shift ? `translateY(${shift * shiftPx}px)` : "";
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

		/*
		 * Whether or not the order changed, and whether or not it was committed.
		 * A gesture that dragged a row is not a tap on it — an abandoned drag
		 * that put the row back where it started should leave the list exactly as
		 * it was, not open the task.
		 */
		suppressNextClick(row);

		row.removeClass("lv-dragging");
		row.style.transform = "";
		row.style.touchAction = "";
		document.body.removeClass("lv-is-dragging");
		for (const el of siblings) {
			el.style.transform = "";
			el.removeClass("lv-shifted");
		}

		if (commit && target !== opts.index) opts.onDrop(opts.index, target);
	};

	grab.addEventListener("pointerdown", (e: PointerEvent) => {
		// Left button only, and never on a control inside the row.
		if (e.button !== 0) return;
		if (!opts.handle && (e.target as HTMLElement).closest(".lv-no-drag")) return;

		startY = e.clientY;
		pointerId = e.pointerId;
		grab.setPointerCapture(e.pointerId);

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
			const moved = Math.abs(e.clientY - startY);
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
		row.style.transform = `translateY(${e.clientY - startY}px)`;
		preview(e.clientY);
	});

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
