import { setIcon } from "obsidian";
import { Task, isComplete } from "../model/types";
import { formatDate, isOverdue, isToday } from "../model/store";
import { ViewContext } from "../views/context";
import { renderInline } from "./inline";
import { renderImportance } from "./Importance";

/**
 * One task row: checkbox, title, a metadata subtitle, and the importance star.
 * Mirrors the middle pane of the reference UI.
 */
export function renderTaskRow(
	parent: HTMLElement,
	task: Task,
	ctx: ViewContext,
	opts: { showList?: boolean } = {}
): HTMLElement {
	const row = parent.createDiv({ cls: "lists-task" });
	row.toggleClass("is-complete", isComplete(task));
	if (
		ctx.state.selectedTask?.filePath === task.filePath &&
		ctx.state.selectedTask?.line === task.line
	) {
		row.addClass("is-selected");
	}

	/* --- checkbox --- */
	const box = row.createDiv({ cls: "lists-check" });
	box.setAttribute("role", "checkbox");
	box.setAttribute("aria-checked", String(isComplete(task)));
	box.setAttribute("aria-label", isComplete(task) ? "Mark not done" : "Mark done");
	box.setAttribute("tabindex", "0");
	setIcon(box, isComplete(task) ? "check-circle-2" : "circle");

	const toggle = async (e: Event) => {
		e.stopPropagation();
		await ctx.mutator.toggle(task);
	};
	box.addEventListener("click", toggle);
	box.addEventListener("keydown", (e) => {
		if (e.key === "Enter" || e.key === " ") void toggle(e);
	});

	/* --- body --- */
	const body = row.createDiv({ cls: "lists-task-body" });
	const titleEl = body.createDiv({ cls: "lists-task-title" });
	renderInline(titleEl, task.title, ctx);

	const bits: { text: string; cls?: string }[] = [];
	if (opts.showList) {
		const name = task.filePath.split("/").pop()?.replace(/\.md$/, "");
		if (name) bits.push({ text: name });
	}
	if (task.section) bits.push({ text: task.section });
	if (task.meta.myDay) bits.push({ text: "My Day" });

	if (ctx.settings.enableSubtasks && task.children.length) {
		const done = task.children.filter((c) => isComplete(c)).length;
		bits.push({ text: `${done} of ${task.children.length}` });
	}
	if (task.meta.repeat) bits.push({ text: task.meta.repeat });
	if (task.meta.due) {
		bits.push({
			text: formatDate(task.meta.due),
			cls: isOverdue(task.meta.due)
				? "is-overdue"
				: isToday(task.meta.due)
					? "is-today"
					: undefined,
		});
	}
	if (task.meta.done) bits.push({ text: `Completed ${formatDate(task.meta.done)}` });
	if (task.note) bits.push({ text: "Note" });

	if (bits.length) {
		const meta = body.createDiv({ cls: "lists-task-meta" });
		bits.forEach((b, i) => {
			if (i > 0) meta.createSpan({ cls: "lists-sep", text: "·" });
			const span = meta.createSpan({ text: b.text });
			if (b.cls) span.addClass(b.cls);
		});
	}

	/* --- importance --- */
	renderImportance(row, task, ctx);

	/* --- selection --- */
	row.addEventListener("click", () => {
		ctx.selectTask(task);
		if (!ctx.wide) ctx.showPane("detail");
	});

	return row;
}
