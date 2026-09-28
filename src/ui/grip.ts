import { setIcon } from "obsidian";

/**
 * The handle a row is dragged by, on every input there is.
 *
 * Not decoration and not a touch affordance bolted onto a mouse behaviour: it is
 * the only surface a drag starts from, which is what lets one code path serve
 * mouse, trackpad, pen and finger.
 *
 * The reason it has to exist at all is `touch-action`. A drag and a scroll are the
 * same gesture on a touchscreen, and the browser decides between them on the first
 * `touchmove` — the only one that is cancelable. So the decision cannot be
 * deferred until intent is known: whatever is under the finger has to declare up
 * front whether it might scroll. A row must say yes, or a list stops scrolling.
 * A grip can say no, and does, in `.lv-grip`.
 *
 * Long-pressing the row is the usual alternative and cannot be made *reliable*,
 * which is a weaker claim than impossible: the browser has already chosen by the
 * time the press expires, so the drag is won or lost on whether the finger
 * happened to stay still. Here it armed at 450ms and a three-pixel wander was
 * enough to lose it, with the row lifted so it looked like a drag had started.
 * Shorter presses fail less often rather than differently.
 */
export function renderGrip(parent: HTMLElement): HTMLElement {
	const grip = parent.createDiv({ cls: "lv-grip" });
	setIcon(grip, "grip-vertical");
	// Nothing to announce: it does the same job the row's own drag does, and a
	// screen reader has no use for a handle it cannot drag.
	grip.setAttribute("aria-hidden", "true");
	// A press that never became a drag must not fall through to the row, or
	// touching the handle would open the task.
	grip.addEventListener("click", (e) => e.stopPropagation());
	return grip;
}
