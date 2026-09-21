import { Task } from "../model/types";

/**
 * Which section a task came from, for the places it is shown away from it.
 *
 * A task under its own heading needs no label — the heading is right there, and
 * repeating it on every row is noise. But Completed, the smart views and any
 * computed sort all pull a task out from under its heading, and there the
 * section is the only thing left saying where it belongs.
 *
 * Styled as a label rather than as a tag.
 *
 * It was written `#Section`, and on a list whose tasks carry real tags — #tv,
 * #film, #reality — that is indistinguishable from one. Small, uppercase and
 * letterspaced says "section" without needing a symbol to say it, and stays
 * quiet enough to sit on a row without competing with the title.
 */
export function renderSectionBadge(parent: HTMLElement, task: Task): void {
	if (!task.section) return;
	parent.createDiv({ cls: "lv-section-badge", text: task.section });
}
