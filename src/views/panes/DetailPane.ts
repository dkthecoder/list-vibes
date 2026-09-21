import { setIcon } from "obsidian";
import { DetailContext } from "../context";
import { Task, isComplete,
	TaskList,
} from "../../model/types";
import { formatDate, formatTime, isOverdue, todayISO } from "../../model/store";
import { renderInline } from "../../ui/inline";
import { makeDragSortable } from "../../ui/dragSort";
import { renderCheckbox } from "../../ui/checkbox";
import { autoGrow, boundsOf, sizeToContent } from "../../ui/autoGrow";
import { renderAddButton, submitOnEnter } from "../../ui/addButton";
import { renderImportance } from "../../ui/Importance";

const REPEATS = [
	{ label: "Daily", value: "every day" },
	{ label: "Weekdays", value: "every weekday" },
	{ label: "Weekly", value: "every week" },
	{ label: "Monthly", value: "every month" },
	{ label: "Yearly", value: "every year" },
];

/** Right pane: the expanded task — steps, dates, note. */
export function renderDetailPane(parent: HTMLElement, ctx: DetailContext): void {
	const pane = parent.createDiv({ cls: "lv-pane lv-detail" });
	const ref = ctx.state.selectedTask;
	const task = ref ? ctx.store.findTask(ref.filePath, ref.line) : undefined;

	// The panel only exists while a task is selected, so there is no empty state.
	if (!task) return;

	/*
	 * No header of our own.
	 *
	 * This is a view in Obsidian's right panel now, and a panel there already
	 * has a header: the name, the collapse control, the pane menu. Drawing a
	 * second bar underneath the first with our own close button and our own
	 * title was the overlay's chrome, and in a panel it is one row of duplicated
	 * furniture eating the height the task needs.
	 *
	 * Which list the task belongs to is the view's `getDisplayText`, so it shows
	 * in Obsidian's header where a pane's name belongs.
	 */
	const scroll = pane.createDiv({ cls: "lv-scroll" });

	/* ---------------- title card ---------------- */
	const card = scroll.createDiv({ cls: "lv-card lv-detail-title" });

	renderCheckbox(card, task, () => void ctx.mutator.toggle(task));

	/*
	 * Rendered at rest, raw the moment it is edited.
	 *
	 * The same rule the list title follows, for the same reason: what you edit
	 * has to be what gets written. A title carrying a markdown link showed its
	 * brackets and URL here while the row beside it rendered them, so the panel
	 * read as broken on exactly the lists that use links most — and rendering it
	 * permanently would mean typing into a field that is not showing the text it
	 * is about to save.
	 */
	const titleEl = card.createDiv({ cls: "lv-detail-title-text" });
	titleEl.toggleClass("is-complete", isComplete(task));
	titleEl.setAttribute("role", "textbox");
	titleEl.setAttribute("aria-label", "Task name");

	let editing = false;

	const show = () => {
		titleEl.empty();
		renderInline(titleEl, task.title, ctx);
		titleEl.setAttribute("contenteditable", "false");
	};

	const edit = () => {
		if (editing) return;
		editing = true;
		titleEl.setText(task.title);
		titleEl.setAttribute("contenteditable", "plaintext-only");
		titleEl.focus();
	};

	show();

	// A click on a link inside the title never reaches here: renderInline stops
	// it, so following a link and editing around it stay separate gestures.
	titleEl.addEventListener("click", edit);
	titleEl.addEventListener("focus", edit);

	const commit = () => {
		if (!editing) return;
		editing = false;
		const next = (titleEl.textContent ?? "").trim();
		show();
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

			renderCheckbox(
				row,
				child,
				(e) => {
					e.stopPropagation();
					void ctx.mutator.toggle(child);
				},
				{ small: true }
			);

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
		const addStep = (v: string) => void ctx.mutator.addStep(task, v);

		let input: HTMLTextAreaElement | null = null;
		renderAddButton(add, {
			cls: "lv-step-plus",
			label: "Add step",
			field: () => input,
			onCommit: addStep,
		});

		/*
		 * A textarea, not a text input, so a step longer than the field wraps
		 * instead of scrolling sideways out of sight. Enter still submits — see
		 * the handler below — so it behaves like the single-line box it looks
		 * like, and simply grows when what you are typing needs the room.
		 */
		input = add.createEl("textarea", {
			cls: "lv-step-input",
			attr: {
				rows: "1",
				placeholder: task.children.length ? "Next step" : "Add step",
				"aria-label": "Add a step",
			},
		});
		autoGrow(input);
		submitOnEnter(input);
		input.addEventListener("keydown", (e) => {
			if (e.key !== "Enter") return;
			e.preventDefault();
			const v = input.value.trim();
			if (!v) return;
			input.value = "";
			sizeToContent(input, boundsOf(input));
			addStep(v);
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

	/*
	 * Which group the task is in.
	 *
	 * Dragging could already move a task between groups, and dragging is the
	 * only thing that could — so a task sitting above the first heading had no
	 * way into a group that did not involve aiming. This is the same move, named
	 * rather than performed, and it is the only route on a list long enough that
	 * the group you want is off the screen.
	 *
	 * Only where there is a choice: a list with no headings has no groups to
	 * offer, and a row saying so would be a row saying nothing.
	 */
	const list = ctx.store.getList(task.filePath);
	if (list?.sections.length) {
		const here = task.section;
		action(actions, ctx, {
			id: "group",
			icon: "heading",
			label: here ?? "No group",
			sub: here ? "Group" : "Not in a group",
			active: !!here,
			expands: true,
			options: [
				{
					label: "No group",
					selected: !here,
					onPick: () => void ctx.mutator.moveToSection(task, [], 0, null),
				},
				...list.sections.map((sec) => ({
					label: sec.name,
					selected: sec.line === lineOfSection(list, here),
					onPick: () => {
						// Appended rather than dropped at the top: a task moved by
						// name has not been aimed anywhere in particular, and the
						// end is where adding one would have put it.
						const next = list.sections.find((x) => x.line > sec.line);
						const mine = list.tasks.filter(
							(t) => t.line > sec.line && (!next || t.line < next.line)
						);
						void ctx.mutator.moveToSection(task, mine, mine.length, sec.line);
					},
				})),
			],
		});
	}

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
		attr: { placeholder: "Add note", rows: "1", "aria-label": "Task note" },
	});
	note.value = task.note ?? "";
	// After the value, because setting it from code fires no `input` event and
	// an unmeasured field would open at one row with three lines inside it.
	autoGrow(note);
	note.addEventListener("blur", () => {
		void ctx.mutator.setNote(task, note.value);
	});
	note.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			e.preventDefault();
			note.value = task.note ?? "";
			sizeToContent(note, boundsOf(note));
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
	/*
	 * Give this task its own note.
	 *
	 * Hidden once it already has one — the line becomes a link, and promoting a
	 * link would nest one inside another.
	 */
	const isNote = /\[\[[^\]]+\]\]/.test(task.title);
	if (!isNote) {
		const promote = foot.createDiv({ cls: "clickable-icon lv-detail-promote" });
		setIcon(promote, "file-plus");
		promote.setAttribute("aria-label", "Give this task its own note");
		promote.addEventListener("click", () => ctx.promote(task));
	}

	const trash = foot.createDiv({ cls: "clickable-icon lv-detail-delete" });
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

/**
 * The line of the heading a task is under, found by name among the headings
 * before it. Two groups may share a name, so the task's own position decides
 * which of them it means.
 */
function lineOfSection(list: TaskList, name: string | undefined): number | undefined {
	if (!name) return undefined;
	return list.sections.find((s) => s.name === name)?.line;
}

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

function action(parent: HTMLElement, ctx: DetailContext, o: ActionOpts): void {
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

	/*
	 * The clear slot is always in the row, empty where there is nothing to
	 * clear, so the chevron beside it keeps its column either way. Without it
	 * a row like Repeat pulled its chevron 32px right into the vacant space.
	 */
	if (!o.onClear) {
		row.createDiv({ cls: "lv-action-clear is-empty" });
	} else {
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
	ctx: DetailContext,
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

async function pickTime(ctx: DetailContext, task: Task): Promise<void> {
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
