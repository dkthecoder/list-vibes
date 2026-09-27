import { renderCheckbox } from "./checkbox";
import { confettiBurst } from "./burst";
import { Task, isComplete } from "../model/types";
import { formatDate, formatStamp, isOverdue, isToday } from "../model/store";
import { ViewContext } from "../views/context";
import { renderInline } from "./inline";
import { renderImportance } from "./Importance";
import { notePreview } from "./notePreview";
import { renderSectionBadge } from "./sectionBadge";
import { applyLeaving, markLeaving, clearLeaving, leavingKey } from "../views/leaving";

/**
 * One task row: checkbox, title, a metadata subtitle, and the importance star.
 * Mirrors the middle pane of the reference UI.
 */
export function renderTaskRow(
	parent: HTMLElement,
	task: Task,
	ctx: ViewContext,
	opts: { showList?: boolean; showSection?: boolean } = {}
): HTMLElement {
	const row = parent.createDiv({ cls: "lv-task" });
	// Identity that survives a repaint, so a scroller can put the row the reader
	// was looking at back where it was.
	row.dataset.lvKey = leavingKey(task.filePath, task.line);
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
		const key = leavingKey(task.filePath, task.line);
		if (isComplete(task)) {
			// Un-ticking inside the window is the undo this whole delay exists for.
			clearLeaving(ctx.state.leaving, key);
		} else {
			// Completing only. Un-ticking is a correction, not an achievement.
			if (ctx.settings.confetti) confettiBurst(e.target as HTMLElement);
			markLeaving(ctx.state.leaving, key, Date.now());
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
	// Rendered rather than plain, so a link in the preview is reachable without
	// opening the task. renderInline stops the click, leaving the rest of the
	// row to open the detail as before.
	if (preview) renderInline(body.createDiv({ cls: "lv-task-note" }), preview, ctx);

	const bits: { text: string; cls?: string }[] = [];
	if (opts.showList) {
		const name = task.filePath.split("/").pop()?.replace(/\.md$/, "");
		if (name) bits.push({ text: name });
	}
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

	/*
	 * The section sits at the far right, not among the metadata.
	 *
	 * A grouped list names the section once in its heading, so repeating it on
	 * every row is noise. Where the row is shown away from that heading —
	 * Completed, a smart view, a computed sort — it is the only thing saying
	 * where the task belongs, and it is about grouping rather than about the
	 * task, so it sits apart from the chips that describe the task itself.
	 */
	if (opts.showSection) renderSectionBadge(row, task);

	/* --- importance --- */
	renderImportance(row, task, ctx);

	/* --- selection --- */
	row.addEventListener("click", () => {
		ctx.selectTask(task);
		if (!ctx.wide) ctx.showPane("detail");
	});

	/*
	 * Last, because it measures the row: the collapse needs a height to close
	 * from, and the children are only there once they have been built.
	 *
	 * Only ever a task that is done. Completing a repeating task inserts the next
	 * occurrence above it, which moves every line below down one — so a key held
	 * here can come to point at a line that has become a new, unfinished task, and
	 * crossing that out would fade away the row the tick had just created.
	 */
	if (isComplete(task)) {
		applyLeaving(row, ctx.state.leaving, leavingKey(task.filePath, task.line), Date.now());
	}

	return row;
}
