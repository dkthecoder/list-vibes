import { DetailContext } from "../views/context";
import { parseInline, renderInline } from "./inline";

/**
 * Render a description as elements, so the links inside it are live.
 *
 * `renderInline` is built for a title: one line, a handful of constructs, and
 * cheap enough to run per row on a long list. A description is many lines, and
 * since notes started keeping their bullets and fences it can hold anything.
 *
 * Each line is rendered on its own and separated by a `<br>`, which keeps a
 * blank line blank. Only *inline* markdown is rendered — a `- bullet` line
 * stays the characters that were typed rather than becoming a list — because
 * the description is a text field that happens to contain links, not a document.
 */
export function renderNote(
	el: HTMLElement,
	text: string,
	ctx: DetailContext
): void {
	const lines = text.split("\n");
	lines.forEach((line, i) => {
		if (i > 0) el.createEl("br");
		if (line) renderInline(el, line, ctx);
	});
}

/**
 * Does this text render to exactly the characters it is written with?
 *
 * A bare URL does. `[label](href)` and `[[note|label]]` do not — they render
 * shorter than their source, so a position in the rendered text no longer
 * means the same position in the file. Clicking into a description places the
 * caret where it was clicked only when the two agree; see `caretOffset`.
 */
export function rendersVerbatim(text: string): boolean {
	return parseInline(text).every((p) => {
		switch (p.t) {
			case "text":
				return true;
			case "link":
				return p.label === p.href;
			default:
				return false;
		}
	});
}

type CaretDoc = Document & {
	caretPositionFromPoint?: (
		x: number,
		y: number
	) => { offsetNode: Node; offset: number } | null;
};

/**
 * Where in `text` a click inside the rendered view landed, or undefined.
 *
 * Undefined rather than a guess: returning the wrong offset drops the caret
 * somewhere the user did not click, which is worse than putting it at the end
 * and letting them aim again. So this gives up when the browser cannot place
 * the point, and the caller gives up when the text does not render verbatim.
 */
export function caretOffset(
	root: HTMLElement,
	x: number,
	y: number
): number | undefined {
	const doc = root.ownerDocument as CaretDoc;
	/*
	 * The standard call only. Its predecessor, caretRangeFromPoint, is
	 * deprecated and this repo does not allow reaching for it — so where the
	 * standard one is missing the caret goes to the end of the text, which is
	 * merely unhelpful rather than wrong.
	 */
	const pos = doc.caretPositionFromPoint?.(x, y);
	const node = pos?.offsetNode;
	const offset = pos?.offset;
	if (!node || offset === undefined || !root.contains(node)) return undefined;

	let seen = 0;
	let found = false;

	const walk = (current: Node): void => {
		if (found) return;
		if (current === node) {
			seen += current.nodeType === Node.TEXT_NODE ? offset : 0;
			found = true;
			return;
		}
		if (current.nodeType === Node.TEXT_NODE) {
			seen += current.textContent?.length ?? 0;
			return;
		}
		// A <br> is the newline the renderer drew in its place.
		if (current.nodeName === "BR") {
			seen += 1;
			return;
		}
		current.childNodes.forEach(walk);
	};

	root.childNodes.forEach(walk);
	return found ? seen : undefined;
}
