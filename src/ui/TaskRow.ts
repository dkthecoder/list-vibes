import { renderCheckbox } from "./checkbox";
import { centreOf, confettiBurst } from "./confetti";
import { Task, isComplete } from "../model/types";
import { formatDate, formatStamp, isOverdue, isToday } from "../model/store";
import { ViewContext } from "../views/context";
import { renderInline } from "./inline";
import { renderImportance } from "./Importance";
import { notePreview } from "./notePreview";

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
	const row = parent.createDiv({ cls: "lv-task" });
	row.toggleClass("is-complete", isComplete(task));
	if (
		ctx.state.selectedTask?.filePath === task.filePath &&
		ctx.state.selectedTask?.line === task.line
	) {
		row.addClass("is-selected");
	}

	/* --- checkbox --- */
	renderCheckbox(row, task, (e) => {
		e.stopPropagation();
		// Completing only. Un-ticking is a correction, not an achievement.
		if (ctx.settings.confetti && !isComplete(task)) {
			confettiBurst(centreOf(e.target as HTMLElement));
		}
		void ctx.mutator.toggle(task);
	});

	/* --- body --- */
	const body = row.createDiv({ cls: "lv-task-body" });
	const titleEl = body.createDiv({ cls: "lv-task-title" });
	renderInline(titleEl, task.title, ctx);

	/*
	 * The note, one faint line, cut off where the row runs out.
	 *
	 * It sits between the title and the metadata rather than among the metadata
	 * chips, because it is the task's own words and they are not a chip. A chip
	 * reading "Note" told you a note existed and nothing else, which meant
	 * opening the task to find out whether it mattered.
	 */
	const preview = notePreview(task.note);
	if (preview) body.createDiv({ cls: "lv-task-note", text: preview });

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
	if (task.meta.done) bits.push({ text: `Completed ${formatStamp(task.meta.done)}` });

	if (bits.length) {
		const meta = body.createDiv({ cls: "lv-task-meta" });
		bits.forEach((b, i) => {
			if (i > 0) meta.createSpan({ cls: "lv-sep", text: "·" });
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
