/**
 * View-only sorting. Nothing here touches a file — the markdown keeps its own
 * order, and "custom" simply means that order. Changing the sort never rewrites
 * anything, which is why it is safe to expose as a one-tap control.
 */

import { Priority, Task, isComplete } from "./types";

export type SortKey =
	| "custom"
	| "importance"
	| "due"
	| "created-desc"
	| "created-asc"
	| "alpha-asc"
	| "alpha-desc";

export const SORT_OPTIONS: { key: SortKey; label: string; icon: string }[] = [
	{ key: "custom", label: "Custom order", icon: "list" },
	{ key: "importance", label: "Importance", icon: "star" },
	{ key: "due", label: "Due date", icon: "calendar" },
	{ key: "created-desc", label: "Date created — newest", icon: "arrow-down-narrow-wide" },
	{ key: "created-asc", label: "Date created — oldest", icon: "arrow-up-narrow-wide" },
	{ key: "alpha-asc", label: "Alphabetical A–Z", icon: "arrow-down-a-z" },
	{ key: "alpha-desc", label: "Alphabetical Z–A", icon: "arrow-up-a-z" },
];

/**
 * 5 stars is most important, 1 is least, matching a star rating.
 * These are the five Obsidian Tasks priority glyphs, so both importance modes
 * read and write exactly the same field.
 */
export const STARS_BY_PRIORITY: Record<Priority, number> = {
	highest: 5,
	high: 4,
	medium: 3,
	low: 2,
	lowest: 1,
};

export const PRIORITY_BY_STARS: Record<number, Priority | undefined> = {
	0: undefined,
	1: "lowest",
	2: "low",
	3: "medium",
	4: "high",
	5: "highest",
};

/** 0 when unset, so unprioritised tasks sort last. */
export function starsOf(task: Task): number {
	return task.meta.priority ? STARS_BY_PRIORITY[task.meta.priority] : 0;
}

/** The single star maps to "high" — one below highest, as in Microsoft To Do. */
export const STAR_PRIORITY: Priority = "high";

export function isStarred(task: Task): boolean {
	return task.meta.priority === "high" || task.meta.priority === "highest";
}

/**
 * Sort a list of tasks for display.
 *
 * Every comparator falls back to the original file order, so sorting is stable
 * and two tasks that tie never jump around between repaints.
 */
export function sortTasks(tasks: Task[], key: SortKey): Task[] {
	if (key === "custom") return tasks;

	// Decorate with the original index so ties keep file order.
	const decorated = tasks.map((task, index) => ({ task, index }));

	const cmp = comparator(key);
	decorated.sort((a, b) => cmp(a.task, b.task) || a.index - b.index);

	return decorated.map((d) => d.task);
}

function comparator(key: SortKey): (a: Task, b: Task) => number {
	switch (key) {
		case "importance":
			// Most important first.
			return (a, b) => starsOf(b) - starsOf(a);

		case "due":
			// Soonest first; tasks with no due date go last rather than first.
			return (a, b) => nullsLast(a.meta.due, b.meta.due);

		case "created-desc":
			return (a, b) => nullsLast(b.meta.created, a.meta.created, true);

		case "created-asc":
			return (a, b) => nullsLast(a.meta.created, b.meta.created);

		case "alpha-asc":
			return (a, b) => collate(a.title, b.title);

		case "alpha-desc":
			return (a, b) => collate(b.title, a.title);

		default:
			return () => 0;
	}
}

/**
 * Compare two optional ISO dates, always sending missing values to the end.
 * `flipped` is for descending comparators, where the arguments arrive swapped
 * but "missing goes last" must not swap with them.
 */
function nullsLast(a?: string, b?: string, flipped = false): number {
	if (a === b) return 0;
	if (!a) return flipped ? -1 : 1;
	if (!b) return flipped ? 1 : -1;
	return a < b ? -1 : 1;
}

function collate(a: string, b: string): number {
	return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** Split into open and completed, preserving whatever order was applied. */
export function partitionCompleted(tasks: Task[]): {
	open: Task[];
	done: Task[];
} {
	const open: Task[] = [];
	const done: Task[] = [];
	for (const t of tasks) (isComplete(t) ? done : open).push(t);
	return { open, done };
}

/**
 * Put the lists in the order the user dragged them into.
 *
 * Task order is file order, so moving a task is a real edit to a real file. A
 * list has no file order — the picker reads the folder — so a custom one is
 * stored in settings, and settings drift: files are created, renamed and
 * deleted while the plugin is not looking.
 *
 * So the stored order is treated as a preference rather than a truth. Anything
 * it names that has gone is skipped, and anything it has never heard of keeps
 * the order it arrived in, at the end — a list that appears in the folder
 * should turn up somewhere predictable rather than wherever a sort happens to
 * put it.
 */
export function orderLists(paths: string[], order: string[]): string[] {
	const available = new Set(paths);
	const placed = new Set<string>();
	const out: string[] = [];

	for (const path of order) {
		if (!available.has(path) || placed.has(path)) continue;
		placed.add(path);
		out.push(path);
	}
	for (const path of paths) if (!placed.has(path)) out.push(path);
	return out;
}

/**
 * Split the starred tasks out, so they can be shown above the rest.
 *
 * A band in the view rather than a `## Starred` heading in the file. Writing
 * one would mean moving a task's block out of its own section every time it was
 * starred, and putting it back somewhere on every unstar — a question with no
 * honest answer. Groupings here are view-only, and this is a grouping.
 *
 * Completed tasks are left out: they have their own place at the bottom, and a
 * star on something already done is a record of what mattered rather than a
 * claim on the top of the list.
 */
export function partitionStarred(tasks: Task[]): { starred: Task[]; rest: Task[] } {
	const starred: Task[] = [];
	const rest: Task[] = [];
	for (const t of tasks) {
		if (isStarred(t) && !isComplete(t)) starred.push(t);
		else rest.push(t);
	}
	return { starred, rest };
}
