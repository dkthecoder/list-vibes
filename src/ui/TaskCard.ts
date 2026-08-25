import { setIcon } from "obsidian";
import { Task, isComplete } from "../model/types";
import { formatDate, isOverdue, isToday } from "../model/store";
import { ViewContext } from "../views/context";
import { renderInline } from "./inline";
import { renderImportance } from "./Importance";

/**
 * A task as a Google Keep-style card.
 *
 * The point of the card layout is that everything is on the face — the note and
 * the steps are visible without opening anything, which is what makes Keep feel
 * like glancing at a pinboard rather than drilling into a task manager. So this
 * deliberately shows more than the row does.
 */
export function renderTaskCard(
	parent: HTMLElement,
	task: Task,
	ctx: ViewContext,
	opts: { showList?: boolean } = {}
): HTMLElement {
	const card = parent.createDiv({ cls: "lv-card-task" });
	card.toggleClass("is-complete", isComplete(task));
	if (
		ctx.state.selectedTask?.filePath === task.filePath &&
		ctx.state.selectedTask?.line === task.line
	) {
		card.addClass("is-selected");
	}

	/* --- title row --- */
	const head = card.createDiv({ cls: "lv-card-head" });

	const box = head.createDiv({ cls: "lv-check" });
	box.setAttribute("role", "checkbox");
	box.setAttribute("aria-checked", String(isComplete(task)));
	box.setAttribute("aria-label", isComplete(task) ? "Mark not done" : "Mark done");
	box.setAttribute("tabindex", "0");
	setIcon(box, isComplete(task) ? "check-circle-2" : "circle");

	const toggle = (e: Event) => {
		e.stopPropagation();
		void ctx.mutator.toggle(task);
	};
	box.addEventListener("click", toggle);
	box.addEventListener("keydown", (e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			toggle(e);
		}
	});

	const titleEl = head.createDiv({ cls: "lv-card-title" });
	renderInline(titleEl, task.title, ctx);

	renderImportance(head, task, ctx, { size: "sm" });

	/* --- note, shown rather than hidden --- */
	if (task.note) {
		card.createDiv({ cls: "lv-card-note", text: task.note });
	}

	/* --- steps, also on the face --- */
	if (ctx.settings.enableSubtasks && task.children.length) {
		const steps = card.createDiv({ cls: "lv-card-steps" });
		for (const child of task.children) {
			const row = steps.createDiv({ cls: "lv-card-step" });
			row.toggleClass("is-complete", isComplete(child));

			const cb = row.createDiv({ cls: "lv-check lv-check-sm" });
			setIcon(cb, isComplete(child) ? "check-circle-2" : "circle");
			cb.setAttribute("role", "checkbox");
			cb.setAttribute("aria-checked", String(isComplete(child)));
			cb.addEventListener("click", (e) => {
				e.stopPropagation();
				void ctx.mutator.toggle(child);
			});

			const label = row.createDiv({ cls: "lv-card-step-label" });
			renderInline(label, child.title, ctx);
		}
	}

	/* --- metadata chips --- */
	const bits: { text: string; cls?: string; icon?: string }[] = [];

	if (opts.showList) {
		const name = task.filePath.split("/").pop()?.replace(/\.md$/, "");
		if (name) bits.push({ text: name, icon: "list" });
	}
	if (task.meta.myDay) bits.push({ text: "My Day", icon: "sun" });
	if (task.meta.due) {
		bits.push({
			text: formatDate(task.meta.due),
			icon: "calendar",
			cls: isOverdue(task.meta.due)
				? "is-overdue"
				: isToday(task.meta.due)
					? "is-today"
					: undefined,
		});
	}
	if (task.meta.repeat) bits.push({ text: task.meta.repeat, icon: "repeat" });
	if (task.meta.done) {
		bits.push({ text: formatDate(task.meta.done), icon: "check-check" });
	}

	if (bits.length) {
		const meta = card.createDiv({ cls: "lv-card-meta" });
		for (const b of bits) {
			const chip = meta.createDiv({ cls: "lv-card-chip" });
			if (b.cls) chip.addClass(b.cls);
			if (b.icon) {
				const i = chip.createDiv({ cls: "lv-card-chip-icon" });
				setIcon(i, b.icon);
			}
			chip.createSpan({ text: b.text });
		}
	}

	card.addEventListener("click", () => {
		ctx.selectTask(task);
		if (!ctx.wide) ctx.showPane("detail");
	});

	return card;
}
