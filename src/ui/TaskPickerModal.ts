import { App, FuzzySuggestModal } from "obsidian";
import { ListStore } from "../model/store";
import { Task, isComplete } from "../model/types";

/**
 * Pick any task in the vault, for the detail panel opened from nowhere in
 * particular.
 *
 * A fuzzy suggester rather than a list-then-task pair of screens. Two steps is
 * the shape the panel's empty state describes, and it is the wrong shape once
 * you have used it twice: the user knows the task's name, and typing three
 * letters of it beats choosing a list they have to remember it is in. The list
 * is still shown, as the line under each result, so the same modal answers
 * "which one did I mean" when two tasks are called the same thing.
 *
 * Open tasks first, and completed ones after, because a panel is opened to work
 * on something far more often than to look back at something finished.
 */
export class TaskPickerModal extends FuzzySuggestModal<Task> {
	private store: ListStore;
	private onPick: (task: Task | null) => void;

	constructor(app: App, store: ListStore, onPick: (task: Task | null) => void) {
		super(app);
		this.store = store;
		this.onPick = onPick;
		this.setPlaceholder("Find a task…");
	}

	getItems(): Task[] {
		const all = this.store.getLists().flatMap((list) => list.tasks);
		const open = all.filter((t) => !isComplete(t));
		const done = all.filter((t) => isComplete(t));
		return [...open, ...done];
	}

	getItemText(task: Task): string {
		// The list's name is searchable too, so "work screenshots" finds a task
		// the user remembers by where it lives rather than by its exact words.
		return `${task.title} ${listName(task)}`;
	}

	renderSuggestion(
		match: { item: Task },
		el: HTMLElement
	): ReturnType<FuzzySuggestModal<Task>["renderSuggestion"]> {
		const task = match.item;
		el.createDiv({ text: task.title });
		el.createDiv({
			cls: "lv-picker-sub",
			text: isComplete(task) ? `${listName(task)} · completed` : listName(task),
		});
	}

	onChooseItem(task: Task): void {
		this.onPick(task);
	}
}

function listName(task: Task): string {
	return task.filePath.split("/").pop()?.replace(/\.md$/, "") ?? task.filePath;
}
