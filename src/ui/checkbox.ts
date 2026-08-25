import { Task, isComplete } from "../model/types";

/**
 * A task checkbox, built the way Obsidian builds one.
 *
 * A real `<input type="checkbox" class="task-list-item-checkbox">` carrying
 * `data-task`, rather than a Lucide circle in a `div[role=checkbox]`. That is
 * not decoration: it is the interop contract Obsidian Tasks and Dataview both
 * emit, and themes hang their whole alternate-marker system off it. Minimal and
 * Things style `input[data-task="X"]:checked` with **no ancestor constraint**,
 * so a `[/]` or a `[!]` renders with the user's own theme glyph and colour
 * inside our view, for free. A div with an icon in it gets none of that, and
 * reads as foreign next to every other checkbox in the app.
 *
 * Three details this has to get right, each of which silently breaks a theme
 * rule if missed:
 *
 * 1. **`data-task` goes on both the row and the input.** Reading view puts it
 *    on the `li`, Live Preview puts it on the `input`, and themes match both.
 *    Setting both costs nothing and satisfies either form.
 * 2. **Alternate markers only fire when `checked` is true.** Every theme rule is
 *    `[data-task="X"]:checked`, and Obsidian itself sets `checked` for any
 *    status character other than a space. So `[/]` and `[-]` must be `checked`
 *    even though they are not *done*. Doneness is tracked separately.
 * 3. **The input must be a direct child of the row.** Half the theme selectors
 *    are `li[data-task] > input`, so wrapping it kills them.
 */
export function renderCheckbox(
	row: HTMLElement,
	task: Task,
	onToggle: (e: Event) => void,
	opts: { small?: boolean } = {}
): HTMLInputElement {
	const done = isComplete(task);
	// The status character verbatim, trimmed the way Obsidian trims it, so a
	// custom status like `[/]` reaches the theme's selector intact.
	const status = task.statusChar.trim();

	row.addClass("task-list-item");
	row.toggleClass("is-checked", done);
	row.dataset.task = status;

	const box = row.createEl("input", {
		type: "checkbox",
		cls: "task-list-item-checkbox lv-check lv-no-drag",
	});
	if (opts.small) box.addClass("lv-check-sm");
	box.dataset.task = status;
	// Not `done`: any status other than a space counts as checked, which is what
	// lights up the theme's marker for `[/]`, `[-]`, `[!]` and the rest.
	box.checked = status !== "";
	box.setAttribute("aria-label", done ? "Mark not done" : "Mark done");

	box.addEventListener("click", onToggle);
	// A checkbox is already keyboard-operable; this only stops the row's own
	// Enter handler from firing underneath it.
	box.addEventListener("keydown", (e) => e.stopPropagation());

	return box;
}
