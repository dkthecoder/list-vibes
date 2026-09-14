/**
 * Is the user typing into this element?
 *
 * Not "is it an input". A checkbox is an `<input>`, and its `value` is the
 * string "on" whether or not it is ticked — so a length test counts a focused
 * checkbox as a half-typed word. That held back the repaint after ticking a
 * task until focus happened to move, which left the row sitting in the open
 * list and a second click acting on a line the file no longer had: the box
 * unticked itself and the task dropped into Completed anyway.
 *
 * So the question is asked of the input's type, not of its value.
 */
const TEXT_TYPES = new Set([
	"text",
	"search",
	"url",
	"email",
	"password",
	"tel",
	"number",
	"date",
	"datetime-local",
	"month",
	"time",
	"week",
]);

export function isTextEntry(el: Element | null): boolean {
	if (!el) return false;
	if (el.instanceOf(HTMLTextAreaElement)) return true;
	if (el.instanceOf(HTMLInputElement)) {
		// An empty field has no composition to break and nothing to lose, and is
		// exactly the state a field is left in right after it commits. Without
		// this, adding a step would hold back the very repaint that shows it.
		return TEXT_TYPES.has(el.type) && el.value.length > 0;
	}
	return (el as HTMLElement).isContentEditable === true;
}
