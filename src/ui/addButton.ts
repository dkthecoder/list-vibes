import { setIcon } from "obsidian";

/**
 * The `+` beside a text field, made to actually do something.
 *
 * Both add fields drew a plus and wired nothing to it, so Enter was the only
 * way to commit. On a desktop that is merely a dead control; on a phone it is
 * the whole feature missing, because a soft keyboard's return key is often
 * "Next" rather than a submit and there is nothing else to press.
 *
 * Two details make the difference between a button that works and one that
 * looks like it should:
 *
 * - **The press must not steal focus.** A pointer going down on a button blurs
 *   the field first, which on a phone starts dismissing the keyboard and, here,
 *   would let a repaint replace the input before the click ever lands.
 *   Cancelling the default on pointerdown keeps the caret where it is.
 * - **Focus stays put afterwards**, so a second step can be typed straight
 *   away rather than needing the field tapped again.
 */
export function renderAddButton(
	parent: HTMLElement,
	opts: {
		/** The field this commits. */
		field: () => HTMLInputElement | HTMLTextAreaElement | null;
		/** Called with the trimmed value. Not called when it is empty. */
		onCommit: (value: string) => void;
		label: string;
		cls?: string;
	}
): HTMLElement {
	const el = parent.createDiv({ cls: `clickable-icon ${opts.cls ?? ""}`.trim() });
	setIcon(el, "plus");
	el.setAttribute("role", "button");
	el.setAttribute("tabindex", "0");
	el.setAttribute("aria-label", opts.label);

	const commit = () => {
		const field = opts.field();
		if (!field) return;
		const value = field.value.trim();
		if (!value) {
			// Nothing to add — put the caret back rather than silently doing
			// nothing, so the button always visibly leads somewhere.
			field.focus();
			return;
		}
		field.value = "";
		opts.onCommit(value);
		field.focus();
	};

	// Before the blur, not after it.
	el.addEventListener("pointerdown", (e) => e.preventDefault());
	el.addEventListener("mousedown", (e) => e.preventDefault());
	el.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		commit();
	});
	el.addEventListener("keydown", (e) => {
		if (e.key !== "Enter" && e.key !== " ") return;
		e.preventDefault();
		commit();
	});

	return el;
}

/**
 * Tell a soft keyboard what its return key is for.
 *
 * Without this Android offers "Next", which reads as "move to another field"
 * and is why the return key felt like the wrong way to add something.
 */
export function submitOnEnter(field: HTMLInputElement | HTMLTextAreaElement): void {
	field.setAttribute("enterkeyhint", "done");
}
