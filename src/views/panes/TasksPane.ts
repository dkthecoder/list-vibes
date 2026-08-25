import { Menu, setIcon } from "obsidian";
import { SMART_VIEWS, ViewContext } from "../context";
import { Task, TaskList, ViewMode, isComplete } from "../../model/types";
import { renderTaskRow } from "../../ui/TaskRow";
import { renderTaskCard } from "../../ui/TaskCard";
import { makeDragSortable } from "../../ui/dragSort";
import { todayISO } from "../../model/store";
import { SORT_OPTIONS, partitionCompleted, sortTasks } from "../../model/sort";

/**
 * The task list for the current selection, with completed tasks grouped into a
 * collapsible section beneath and an add box at the bottom that expands upward.
 */
export function renderTasksPane(parent: HTMLElement, ctx: ViewContext): void {
	const pane = parent.createDiv({ cls: "lv-pane lv-tasks" });
	const sel = ctx.state.selection;

	const isSmart = sel.kind === "smart";
	const list = sel.kind === "list" ? ctx.store.getList(sel.path) : undefined;
	if (list?.config.color) pane.addClass(`lv-color-${list.config.color}`);
	// Accent every list, falling back to the theme's own accent colour.
	pane.toggleClass("is-accented", !!list);

	/* ---------------- header ---------------- */
	const header = pane.createDiv({ cls: "lv-header" });

	if (!ctx.wide) {
		const back = header.createDiv({ cls: "lv-back" });
		setIcon(back, "chevron-left");
		back.setAttribute("aria-label", "Back to lists");
		back.addEventListener("click", () => ctx.showPane("nav"));
	}

	const titleWrap = header.createDiv({ cls: "lv-header-title" });
	if (isSmart) {
		const v = SMART_VIEWS.find((s) => s.id === sel.view);
		titleWrap.createSpan({ text: v?.label ?? "Tasks" });
	} else if (list) {
		if (list.config.icon)
			titleWrap.createSpan({ cls: "lv-header-icon", text: list.config.icon });

		// The name IS the filename, so editing it here renames the file.
		const nameEl = titleWrap.createSpan({ cls: "lv-header-name", text: list.name });
		nameEl.setAttribute("contenteditable", "plaintext-only");
		nameEl.setAttribute("role", "textbox");
		nameEl.setAttribute("aria-label", "List name, edit to rename the file");
		nameEl.setAttribute("spellcheck", "false");

		const commit = () => {
			const next = (nameEl.textContent ?? "").trim();
			if (!next || next === list.name) {
				nameEl.setText(list.name);
				return;
			}
			ctx.renameList(list.path, next);
		};
		nameEl.addEventListener("blur", commit);
		nameEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				nameEl.blur();
			}
			if (e.key === "Escape") {
				e.preventDefault();
				nameEl.setText(list.name);
				nameEl.blur();
			}
		});
	} else {
		titleWrap.createSpan({ text: "List" });
	}

	if (!isSmart && list) {
		const sortKey = ctx.sortKey();
		const current = SORT_OPTIONS.find((o) => o.key === sortKey);

		const sortBtn = header.createDiv({ cls: "lv-header-action" });
		sortBtn.toggleClass("is-active", sortKey !== "custom");
		setIcon(sortBtn, "arrow-up-down");
		sortBtn.setAttribute("aria-label", `Sort: ${current?.label ?? "Custom order"}`);
		sortBtn.addEventListener("click", (e) => {
			const menu = new Menu();
			for (const o of SORT_OPTIONS) {
				menu.addItem((i) =>
					i
						.setTitle(o.label)
						.setIcon(o.icon)
						.setChecked(o.key === sortKey)
						.onClick(() => ctx.setSortKey(o.key))
				);
			}
			menu.showAtMouseEvent(e);
		});

		const mode = ctx.viewMode();
		const layout = header.createDiv({ cls: "lv-header-action" });
		layout.toggleClass("is-active", mode === "postit");
		setIcon(layout, mode === "postit" ? "layout-grid" : "list");
		layout.setAttribute(
			"aria-label",
			mode === "postit" ? "Switch to rows" : "Switch to post-it view"
		);
		layout.addEventListener("click", () =>
			ctx.setViewMode(mode === "postit" ? "list" : "postit")
		);

		const more = header.createDiv({ cls: "lv-header-action" });
		setIcon(more, "more-horizontal");
		more.setAttribute("aria-label", "List options");
		more.addEventListener("click", (e) => {
			const menu = new Menu();
			menu.addItem((i) =>
				i
					.setTitle("Open in new tab")
					.setIcon("list-todo")
					.onClick(() => ctx.openInNewTab({ kind: "list", path: list.path }))
			);
			menu.addItem((i) =>
				i
					.setTitle("Rename")
					.setIcon("pencil")
					.onClick(() => {
						const el = header.querySelector<HTMLElement>(".lv-header-name");
						el?.focus();
						// Select the whole name so typing replaces it.
						const range = document.createRange();
						if (el) range.selectNodeContents(el);
						const s = window.getSelection();
						s?.removeAllRanges();
						if (el) s?.addRange(range);
					})
			);
			menu.addItem((i) =>
				i
					.setTitle("Change colour")
					.setIcon("palette")
					.onClick(() => void pickColor(ctx, list))
			);
			menu.addSeparator();
			menu.addItem((i) =>
				i
					.setTitle("Post-it view for new lists")
					.setIcon("layout-grid")
					.setChecked(ctx.defaultViewMode() === "postit")
					.onClick(() =>
						ctx.setDefaultViewMode(
							ctx.defaultViewMode() === "postit" ? "list" : "postit"
						)
					)
			);
			menu.addSeparator();
			menu.addItem((i) =>
				i
					.setTitle("Open as note")
					.setIcon("file-text")
					.onClick(() => void ctx.app.workspace.openLinkText(list.path, "", false))
			);
			menu.addItem((i) =>
				i
					.setTitle(ctx.state.completedOpen ? "Hide completed" : "Show completed")
					.setIcon("check-check")
					.onClick(() => {
						ctx.state.completedOpen = !ctx.state.completedOpen;
						ctx.render("tasks");
					})
			);
			menu.showAtMouseEvent(e);
		});
	}

	/* ---------------- body ---------------- */
	const scroll = pane.createDiv({ cls: "lv-scroll" });

	const raw: Task[] = isSmart
		? ctx.store.getSmartView(sel.view)
		: (list?.tasks ?? []);

	const sortKey = isSmart ? "custom" : ctx.sortKey();
	const { open, done } = partitionCompleted(sortTasks(raw, sortKey));

	if (!open.length && !done.length) {
		const empty = scroll.createDiv({ cls: "lv-empty" });
		const icon = empty.createDiv({ cls: "lv-empty-icon" });
		setIcon(icon, isSmart ? "sun" : "check-check");
		empty.createDiv({
			cls: "lv-empty-title",
			text: isSmart ? "Nothing here yet" : "This list is empty",
		});
		empty.createDiv({
			cls: "lv-empty-body",
			text: isSmart
				? "Tasks you flag or schedule will show up here."
				: "Add your first task below.",
		});
	}

	// Headings only make sense while the file's own order is intact.
	const grouped = sortKey === "custom" && !isSmart;
	const mode = isSmart ? "list" : ctx.viewMode();

	/*
	 * Dragging is only offered where it means something.
	 *
	 * Custom sort *is* the file's order, so moving a row is a real edit to the
	 * file and the new position is what you will see next time. Under any other
	 * sort the order on screen is computed — dropping a task between two others
	 * would write a change the sort immediately undoes, which reads as the drag
	 * having failed. Smart views are excluded for a stronger reason: their rows
	 * come from several files at once, so there is no single order to rewrite.
	 *
	 * Post-it mode is excluded for now because the wall wraps into a grid, and a
	 * vertical drag preview cannot describe a move in two dimensions.
	 */
	const sortable = sortKey === "custom" && !isSmart && mode === "list";
	renderTasks(scroll, open, ctx, { grouped, showList: isSmart, mode, sortable });

	/* ---------------- completed ---------------- */
	const showCompleted =
		(list?.config.showCompleted ?? ctx.settings.showCompleted) !== "hidden";

	if (done.length && showCompleted) {
		const section = scroll.createDiv({ cls: "lv-completed" });
		const head = section.createDiv({ cls: "lv-completed-head" });
		head.setAttribute("tabindex", "0");
		head.setAttribute("role", "button");
		head.setAttribute("aria-expanded", String(ctx.state.completedOpen));

		const chev = head.createDiv({ cls: "lv-completed-chevron" });
		setIcon(chev, ctx.state.completedOpen ? "chevron-down" : "chevron-right");
		head.createSpan({ cls: "lv-completed-label", text: "Completed" });
		head.createSpan({ cls: "lv-completed-count", text: String(done.length) });

		const toggle = () => {
			ctx.state.completedOpen = !ctx.state.completedOpen;
			ctx.render("tasks");
		};
		head.addEventListener("click", toggle);
		head.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				toggle();
			}
		});

		if (ctx.state.completedOpen) {
			const body = section.createDiv({ cls: "lv-completed-body" });
			body.toggleClass("lv-postit", mode === "postit");
			// Deliberately not sortable: this section is a filtered subset of the
			// file, so its rows are not adjacent lines and a splice between two of
			// them would land in the middle of the open tasks above.
			for (const t of done) {
				if (mode === "postit") renderTaskCard(body, t, ctx, { showList: isSmart });
				else renderTaskRow(body, t, ctx, { showList: isSmart });
			}
		}
	}

	/* ---------------- add box ---------------- */
	if (!isSmart || sel.view === "myday") {
		renderAddBox(pane, ctx);
	}
}

/** Render tasks as rows or post-it notes, optionally grouped under headings. */
function renderTasks(
	scroll: HTMLElement,
	tasks: Task[],
	ctx: ViewContext,
	opts: {
		grouped: boolean;
		showList: boolean;
		mode: ViewMode;
		/** Whether rows may be dragged into a new order. */
		sortable: boolean;
	}
): void {
	const postit = opts.mode === "postit";
	const cls = postit ? "lv-group lv-postit" : "lv-group";
	const draw = (parent: HTMLElement, t: Task) =>
		postit
			? renderTaskCard(parent, t, ctx, { showList: opts.showList })
			: renderTaskRow(parent, t, ctx, { showList: opts.showList });

	/**
	 * Wire up dragging for one contiguous run of rows.
	 *
	 * A run is passed rather than the whole list because `##` headings split a
	 * list into groups, and a drag has to stay inside the group it started in —
	 * the file order within a group is contiguous, so a splice inside one is a
	 * plain reorder, whereas dragging across a heading would silently move a task
	 * to another section.
	 */
	const makeSortable = (rows: HTMLElement[], run: Task[]) => {
		if (!opts.sortable || run.length < 2) return;
		rows.forEach((row, index) => {
			row.addClass("lv-sortable");
			makeDragSortable(row, {
				index,
				siblings: () => rows,
				onDrop: (from, to) => void ctx.mutator.reorder(run[from], run, to),
			});
		});
	};

	if (!opts.grouped) {
		const group = scroll.createDiv({ cls });
		makeSortable(
			tasks.map((t) => draw(group, t)),
			tasks
		);
		return;
	}

	let current: string | undefined | null = null;
	let container: HTMLElement | null = null;
	let run: Task[] = [];
	let rows: HTMLElement[] = [];

	const flush = () => {
		makeSortable(rows, run);
		run = [];
		rows = [];
	};

	for (const t of tasks) {
		if (t.section !== current || !container) {
			flush();
			current = t.section;
			if (t.section) scroll.createDiv({ cls: "lv-section", text: t.section });
			container = scroll.createDiv({ cls });
		}
		rows.push(draw(container, t));
		run.push(t);
	}
	flush();
}

async function pickColor(ctx: ViewContext, list: TaskList): Promise<void> {
	const { ColorModal } = await import("../../ui/ColorModal");
	new ColorModal(ctx.app, {
		listName: list.name,
		current: list.config.color,
		onPick: (color) => ctx.setColor(list.path, color),
	}).open();
}

/* ------------------------------------------------------------------ *
 * Add box
 *
 * Collapsed it is a single line: type a title, press Enter, done. Clicking it
 * expands the box upward to add a description field. Both paths create the same
 * task; the expanded one just writes a note line beneath it.
 * ------------------------------------------------------------------ */

function renderAddBox(pane: HTMLElement, ctx: ViewContext): void {
	const sel = ctx.state.selection;
	const expanded = ctx.state.composing;

	const box = pane.createDiv({ cls: "lv-add" });
	box.toggleClass("is-expanded", expanded);

	const top = box.createDiv({ cls: "lv-add-top" });
	const icon = top.createDiv({ cls: "lv-add-icon" });
	setIcon(icon, "plus");

	const title = top.createEl("input", {
		type: "text",
		cls: "lv-add-input",
		attr: { placeholder: "Add a task", "aria-label": "Task name" },
	});

	let description: HTMLTextAreaElement | null = null;

	const commit = async (keepOpen: boolean) => {
		const value = title.value.trim();
		if (!value) return;
		const note = description?.value.trim();

		title.value = "";
		if (description) description.value = "";

		if (sel.kind === "list") {
			await ctx.mutator.addTask(sel.path, value, {}, { note });
		} else {
			// From My Day a task still needs a home list. Use the first one and flag it.
			const first = ctx.store.getLists()[0];
			if (!first) return;
			await ctx.mutator.addTask(
				first.path,
				value,
				{ myDay: true, due: todayISO() },
				{ note }
			);
		}

		if (!keepOpen) {
			ctx.state.composing = false;
			ctx.render("tasks");
		} else {
			title.focus();
		}
	};

	const expand = () => {
		if (ctx.state.composing) return;
		ctx.state.composing = true;
		ctx.render("tasks");
	};

	title.addEventListener("focus", expand);
	title.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			void commit(true);
		}
		if (e.key === "Escape") {
			e.preventDefault();
			title.value = "";
			ctx.state.composing = false;
			ctx.render("tasks");
		}
	});

	if (!expanded) return;

	/* --- expanded: description + actions --- */
	description = box.createEl("textarea", {
		cls: "lv-add-note",
		attr: {
			placeholder: "Add a description",
			rows: "2",
			"aria-label": "Description",
		},
	});
	description.addEventListener("keydown", (e) => {
		// Enter inside the description adds a newline; Cmd/Ctrl+Enter submits.
		if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			void commit(false);
		}
		if (e.key === "Escape") {
			e.preventDefault();
			ctx.state.composing = false;
			ctx.render("tasks");
		}
	});

	const actions = box.createDiv({ cls: "lv-add-actions" });

	const cancel = actions.createEl("button", {
		cls: "lv-add-cancel",
		text: "Cancel",
	});
	cancel.addEventListener("click", () => {
		ctx.state.composing = false;
		ctx.render("tasks");
	});

	const add = actions.createEl("button", { cls: "mod-cta", text: "Add task" });
	add.addEventListener("click", () => void commit(false));
}
