import { setIcon } from "obsidian";
import { ViewContext } from "../context";
import { Task, isComplete } from "../../model/types";
import { formatDate, formatTime, isOverdue, todayISO } from "../../model/store";
import { renderInline } from "../../ui/inline";
import { makeDragSortable } from "../../ui/dragSort";
import { renderImportance } from "../../ui/Importance";

const REPEATS = [
	{ label: "Daily", value: "every day" },
	{ label: "Weekdays", value: "every weekday" },
	{ label: "Weekly", value: "every week" },
	{ label: "Monthly", value: "every month" },
	{ label: "Yearly", value: "every year" },
];

/** Right pane: the expanded task — steps, dates, note. */
export function renderDetailPane(parent: HTMLElement, ctx: ViewContext): void {
	const pane = parent.createDiv({ cls: "lv-pane lv-detail" });
	const ref = ctx.state.selectedTask;
	const task = ref ? ctx.store.findTask(ref.filePath, ref.line) : undefined;

	// The panel only exists while a task is selected, so there is no empty state.
	if (!task) return;

	/* ---------------- header ---------------- */
	const bar = pane.createDiv({ cls: "lv-detail-bar" });
	const close = bar.createDiv({ cls: "lv-back" });
	setIcon(close, "x");
	close.setAttribute("aria-label", "Close");
	close.addEventListener("click", () => ctx.selectTask(null));
	bar.createDiv({
		cls: "lv-detail-bar-title",
		text: task.filePath.split("/").pop()?.replace(/\.md$/, "") ?? "",
	});

	const scroll = pane.createDiv({ cls: "lv-scroll" });

	/* ---------------- title card ---------------- */
	const card = scroll.createDiv({ cls: "lv-card lv-detail-title" });

	const box = card.createDiv({ cls: "lv-check" });
	setIcon(box, isComplete(task) ? "check-circle-2" : "circle");
	box.setAttribute("role", "checkbox");
	box.setAttribute("aria-checked", String(isComplete(task)));
	box.setAttribute("aria-label", isComplete(task) ? "Mark not done" : "Mark done");
	box.addEventListener("click", () => void ctx.mutator.toggle(task));

	const titleEl = card.createDiv({ cls: "lv-detail-title-text" });
	titleEl.toggleClass("is-complete", isComplete(task));
	titleEl.setAttribute("contenteditable", "plaintext-only");
	titleEl.setAttribute("role", "textbox");
	titleEl.setAttribute("aria-label", "Task name");
	titleEl.setText(task.title);

	const commit = () => {
		const next = (titleEl.textContent ?? "").trim();
		if (next && next !== task.title) void ctx.mutator.rename(task, next);
	};
	titleEl.addEventListener("blur", commit);
	titleEl.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			titleEl.blur();
		}
		if (e.key === "Escape") {
			titleEl.setText(task.title);
			titleEl.blur();
		}
	});

	renderImportance(card, task, ctx);

	/* ---------------- steps ---------------- */
	if (ctx.settings.enableSubtasks) {
		const steps = scroll.createDiv({ cls: "lv-card lv-steps" });

		const stepRows: HTMLElement[] = [];
		for (const child of task.children) {
			const row = steps.createDiv({ cls: "lv-step" });
			row.toggleClass("is-complete", isComplete(child));
			stepRows.push(row);

			const cb = row.createDiv({ cls: "lv-check lv-check-sm lv-no-drag" });
			setIcon(cb, isComplete(child) ? "check-circle-2" : "circle");
			cb.setAttribute("role", "checkbox");
			cb.setAttribute("aria-checked", String(isComplete(child)));
			cb.addEventListener("click", () => void ctx.mutator.toggle(child));

			const label = row.createDiv({ cls: "lv-step-label" });
			renderInline(label, child.title, ctx);

			const del = row.createDiv({ cls: "lv-step-remove lv-no-drag" });
			setIcon(del, "x");
			del.setAttribute("aria-label", "Remove step");
			del.addEventListener("click", () => void ctx.mutator.remove(child));
		}

		/*
		 * Steps reorder within their own parent and nowhere else. They are always
		 * in file order — there is no sort applied to steps — so unlike the task
		 * list this needs no guard beyond having two of them to swap.
		 */
		if (stepRows.length > 1) {
			const siblings = task.children;
			stepRows.forEach((row, index) => {
				row.addClass("lv-sortable");
				makeDragSortable(row, {
					index,
					siblings: () => stepRows,
					onDrop: (from, to) =>
						void ctx.mutator.reorder(siblings[from], siblings, to),
				});
			});
		}

		const add = steps.createDiv({ cls: "lv-step lv-step-add" });
		const plus = add.createDiv({ cls: "lv-check lv-check-sm" });
		setIcon(plus, "plus");
		const input = add.createEl("input", {
			type: "text",
			cls: "lv-step-input",
			attr: {
				placeholder: task.children.length ? "Next step" : "Add step",
				"aria-label": "Add a step",
			},
		});
		input.addEventListener("keydown", (e) => {
			if (e.key !== "Enter") return;
			e.preventDefault();
			const v = input.value.trim();
			if (!v) return;
			input.value = "";
			void ctx.mutator.addStep(task, v);
		});
	}

	/* ---------------- actions ---------------- *
	 *
	 * These open inline, expanding in place beneath the row they belong to.
	 * They used to be Obsidian Menus, which read as right-click context menus
	 * appearing under the cursor — wrong for a primary control, and awkward on
	 * touch where there is no cursor to anchor to.
	 * ------------------------------------------------------------------ */

	const actions = scroll.createDiv({ cls: "lv-card lv-actions" });

	action(actions, ctx, {
		id: "myday",
		icon: "sun",
		label: task.meta.myDay ? "Added to My Day" : "Add to My Day",
		active: !!task.meta.myDay,
		onClick: () => void ctx.mutator.toggleMyDay(task),
		onClear: task.meta.myDay
			? () => void ctx.mutator.setField(task, "myDay", null)
			: undefined,
	});

	action(actions, ctx, {
		id: "reminder",
		icon: "bell",
		label: task.meta.reminder
			? `Remind me at ${formatTime(task.meta.reminder)}`
			: "Remind me",
		sub: task.meta.reminder ? formatDate(task.meta.due ?? todayISO()) : undefined,
		active: !!task.meta.reminder,
		expands: true,
		options: [
			...["09:00", "12:00", "17:00", "20:00"].map((t) => ({
				label: formatTime(t),
				selected: task.meta.reminder === t,
				onPick: () => void ctx.mutator.setField(task, "reminder", t),
			})),
			{
				label: "Pick a time…",
				onPick: () => void pickTime(ctx, task),
			},
		],
		onClear: task.meta.reminder
			? () => void ctx.mutator.setField(task, "reminder", null)
			: undefined,
	});

	action(actions, ctx, {
		id: "due",
		icon: "calendar",
		label: task.meta.due ? `Due ${formatDate(task.meta.due)}` : "Add due date",
		active: !!task.meta.due,
		danger: isOverdue(task.meta.due),
		expands: true,
		options: [
			{
				label: "Today",
				selected: task.meta.due === todayISO(),
				onPick: () => void ctx.mutator.setField(task, "due", todayISO()),
			},
			{
				label: "Tomorrow",
				selected: task.meta.due === addDays(1),
				onPick: () => void ctx.mutator.setField(task, "due", addDays(1)),
			},
			{
				label: "Next week",
				onPick: () =>
					void ctx.mutator.setField(task, "due", addDays(daysUntilWeekday(1))),
			},
			{
				label: "Pick a date…",
				onPick: () => void pickDate(ctx, task, "due"),
			},
		],
		onClear: task.meta.due
			? () => void ctx.mutator.setField(task, "due", null)
			: undefined,
	});

	action(actions, ctx, {
		id: "repeat",
		icon: "repeat",
		label: task.meta.repeat ? capitalise(task.meta.repeat) : "Repeat",
		active: !!task.meta.repeat,
		expands: true,
		options: REPEATS.map((r) => ({
			label: r.label,
			selected: task.meta.repeat === r.value,
			onPick: () => void ctx.mutator.setField(task, "repeat", r.value),
		})),
		onClear: task.meta.repeat
			? () => void ctx.mutator.setField(task, "repeat", null)
			: undefined,
	});

	/* ---------------- note ---------------- */
	const noteCard = scroll.createDiv({ cls: "lv-card lv-note" });
	const note = noteCard.createEl("textarea", {
		cls: "lv-note-input",
		attr: { placeholder: "Add note", rows: "3", "aria-label": "Task note" },
	});
	note.value = task.note ?? "";
	note.addEventListener("blur", () => {
		void ctx.mutator.setNote(task, note.value);
	});
	note.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			e.preventDefault();
			note.value = task.note ?? "";
			note.blur();
		}
	});

	/* ---------------- footer ---------------- */
	const foot = pane.createDiv({ cls: "lv-detail-foot" });
	foot.createSpan({
		cls: "lv-detail-created",
		text: task.meta.created
			? `Created ${formatDate(task.meta.created)}`
			: `In ${task.filePath.split("/").pop()?.replace(/\.md$/, "")}`,
	});
	const trash = foot.createDiv({ cls: "lv-detail-delete" });
	setIcon(trash, "trash-2");
	trash.setAttribute("aria-label", "Delete task");
	trash.addEventListener("click", () => {
		void ctx.mutator.remove(task);
		ctx.selectTask(null);
	});
}

/* ------------------------------------------------------------------ *
 * An action row, optionally expanding into a row of choices.
 * ------------------------------------------------------------------ */

interface PickOption {
	label: string;
	selected?: boolean;
	onPick: () => void;
}

interface ActionOpts {
	/** Identifies which row is open, so only one is at a time. */
	id: string;
	icon: string;
	label: string;
	sub?: string;
	active?: boolean;
	danger?: boolean;
	/** When set, clicking the row reveals `options` beneath it. */
	expands?: boolean;
	options?: PickOption[];
	onClick?: () => void;
	onClear?: () => void;
}

function action(parent: HTMLElement, ctx: ViewContext, o: ActionOpts): void {
	const open = ctx.state.openAction === o.id;

	const wrap = parent.createDiv({ cls: "lv-action-wrap" });
	const row = wrap.createDiv({ cls: "lv-action" });
	row.toggleClass("is-active", !!o.active);
	row.toggleClass("is-danger", !!o.danger);
	row.toggleClass("is-open", open);
	row.setAttribute("tabindex", "0");
	row.setAttribute("role", "button");
	if (o.expands) row.setAttribute("aria-expanded", String(open));

	const icon = row.createDiv({ cls: "lv-action-icon" });
	setIcon(icon, o.icon);

	const text = row.createDiv({ cls: "lv-action-text" });
	text.createDiv({ cls: "lv-action-label", text: o.label });
	if (o.sub) text.createDiv({ cls: "lv-action-sub", text: o.sub });

	const activate = () => {
		if (o.expands) {
			ctx.state.openAction = open ? null : o.id;
			ctx.render("detail");
			return;
		}
		o.onClick?.();
	};

	row.addEventListener("click", (e) => {
		if ((e.target as HTMLElement).closest(".lv-action-clear")) return;
		activate();
	});
	row.addEventListener("keydown", (e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			activate();
		}
	});

	if (o.expands) {
		const chev = row.createDiv({ cls: "lv-action-chevron" });
		setIcon(chev, open ? "chevron-up" : "chevron-down");
	}

	if (o.onClear) {
		const clear = row.createDiv({ cls: "lv-action-clear" });
		setIcon(clear, "x");
		clear.setAttribute("aria-label", `Clear ${o.label}`);
		clear.addEventListener("click", (e) => {
			e.stopPropagation();
			ctx.state.openAction = null;
			o.onClear?.();
		});
	}

	if (!open || !o.options?.length) return;

	const options = wrap.createDiv({ cls: "lv-action-options" });
	for (const opt of o.options) {
		const chip = options.createEl("button", {
			cls: "lv-chip",
			text: opt.label,
		});
		chip.toggleClass("is-selected", !!opt.selected);
		chip.addEventListener("click", (e) => {
			e.stopPropagation();
			// Collapse on choose: the row's own label now shows the answer.
			ctx.state.openAction = null;
			opt.onPick();
		});
	}
}

function addDays(n: number): string {
	const d = new Date();
	d.setDate(d.getDate() + n);
	const p = (x: number) => String(x).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Days until the next occurrence of a weekday, 1-7. */
function daysUntilWeekday(target: number): number {
	const diff = (target - new Date().getDay() + 7) % 7;
	return diff === 0 ? 7 : diff;
}

async function pickDate(
	ctx: ViewContext,
	task: Task,
	field: "due" | "scheduled"
): Promise<void> {
	const { InputModal } = await import("../../ui/InputModal");
	new InputModal(ctx.app, {
		title: "Pick a date",
		type: "date",
		value: task.meta[field] ?? todayISO(),
		onSubmit: (v) => {
			if (/^\d{4}-\d{2}-\d{2}$/.test(v)) void ctx.mutator.setField(task, field, v);
		},
	}).open();
}

async function pickTime(ctx: ViewContext, task: Task): Promise<void> {
	const { InputModal } = await import("../../ui/InputModal");
	new InputModal(ctx.app, {
		title: "Pick a time",
		type: "time",
		value: task.meta.reminder ?? "09:00",
		onSubmit: (v) => {
			if (/^\d{1,2}:\d{2}$/.test(v)) void ctx.mutator.setField(task, "reminder", v);
		},
	}).open();
}

function capitalise(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
