import { Menu, setIcon } from "obsidian";
import { SMART_VIEWS, ViewContext } from "../context";
import { Task, isComplete } from "../../model/types";
import { renderTaskRow } from "../../ui/TaskRow";
import { todayISO } from "../../model/store";
import { SORT_OPTIONS, partitionCompleted, sortTasks } from "../../model/sort";

/**
 * The task list for the current selection, with completed tasks grouped into a
 * collapsible section beneath and an add box at the bottom that expands upward.
 */
export function renderTasksPane(parent: HTMLElement, ctx: ViewContext): void {
	const pane = parent.createDiv({ cls: "lists-pane lists-tasks" });
	const sel = ctx.state.selection;

	const isSmart = sel.kind === "smart";
	const list = sel.kind === "list" ? ctx.store.getList(sel.path) : undefined;

	/* ---------------- header ---------------- */
	const header = pane.createDiv({ cls: "lists-header" });

	if (!ctx.wide) {
		const back = header.createDiv({ cls: "lists-back" });
		setIcon(back, "chevron-left");
		back.setAttribute("aria-label", "Back to lists");
		back.addEventListener("click", () => ctx.showPane("nav"));
	}

	const titleWrap = header.createDiv({ cls: "lists-header-title" });
	if (isSmart) {
		const v = SMART_VIEWS.find((s) => s.id === sel.view);
		titleWrap.createSpan({ text: v?.label ?? "Tasks" });
	} else {
		if (list?.config.icon)
			titleWrap.createSpan({ cls: "lists-header-icon", text: list.config.icon });
		titleWrap.createSpan({ text: list?.name ?? "List" });
	}

	if (!isSmart && list) {
		const sortKey = ctx.sortKey();
		const current = SORT_OPTIONS.find((o) => o.key === sortKey);

		const sortBtn = header.createDiv({ cls: "lists-header-action" });
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

		const more = header.createDiv({ cls: "lists-header-action" });
		setIcon(more, "more-horizontal");
		more.setAttribute("aria-label", "List options");
		more.addEventListener("click", (e) => {
			const menu = new Menu();
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
						ctx.render();
					})
			);
			menu.showAtMouseEvent(e);
		});
	}

	/* ---------------- body ---------------- */
	const scroll = pane.createDiv({ cls: "lists-scroll" });

	const raw: Task[] = isSmart
		? ctx.store.getSmartView(sel.view)
		: (list?.tasks ?? []);

	const sortKey = isSmart ? "custom" : ctx.sortKey();
	const { open, done } = partitionCompleted(sortTasks(raw, sortKey));

	if (!open.length && !done.length) {
		const empty = scroll.createDiv({ cls: "lists-empty" });
		const icon = empty.createDiv({ cls: "lists-empty-icon" });
		setIcon(icon, isSmart ? "sun" : "check-check");
		empty.createDiv({
			cls: "lists-empty-title",
			text: isSmart ? "Nothing here yet" : "This list is empty",
		});
		empty.createDiv({
			cls: "lists-empty-body",
			text: isSmart
				? "Tasks you flag or schedule will show up here."
				: "Add your first task below.",
		});
	}

	// Headings only make sense while the file's own order is intact.
	const grouped = sortKey === "custom" && !isSmart;
	renderTasks(scroll, open, ctx, { grouped, showList: isSmart });

	/* ---------------- completed ---------------- */
	const showCompleted =
		(list?.config.showCompleted ?? ctx.settings.showCompleted) !== "hidden";

	if (done.length && showCompleted) {
		const section = scroll.createDiv({ cls: "lists-completed" });
		const head = section.createDiv({ cls: "lists-completed-head" });
		head.setAttribute("tabindex", "0");
		head.setAttribute("role", "button");
		head.setAttribute("aria-expanded", String(ctx.state.completedOpen));

		const chev = head.createDiv({ cls: "lists-completed-chevron" });
		setIcon(chev, ctx.state.completedOpen ? "chevron-down" : "chevron-right");
		head.createSpan({ cls: "lists-completed-label", text: "Completed" });
		head.createSpan({ cls: "lists-completed-count", text: String(done.length) });

		const toggle = () => {
			ctx.state.completedOpen = !ctx.state.completedOpen;
			ctx.render();
		};
		head.addEventListener("click", toggle);
		head.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				toggle();
			}
		});

		if (ctx.state.completedOpen) {
			const body = section.createDiv({ cls: "lists-completed-body" });
			for (const t of done) renderTaskRow(body, t, ctx, { showList: isSmart });
		}
	}

	/* ---------------- add box ---------------- */
	if (!isSmart || sel.view === "myday") {
		renderAddBox(pane, ctx);
	}
}

/** Render tasks, optionally grouped under their source headings. */
function renderTasks(
	scroll: HTMLElement,
	tasks: Task[],
	ctx: ViewContext,
	opts: { grouped: boolean; showList: boolean }
): void {
	if (!opts.grouped) {
		const group = scroll.createDiv({ cls: "lists-group" });
		for (const t of tasks) renderTaskRow(group, t, ctx, { showList: opts.showList });
		return;
	}

	let current: string | undefined | null = null;
	let container: HTMLElement | null = null;

	for (const t of tasks) {
		if (t.section !== current || !container) {
			current = t.section;
			if (t.section) scroll.createDiv({ cls: "lists-section", text: t.section });
			container = scroll.createDiv({ cls: "lists-group" });
		}
		renderTaskRow(container, t, ctx, { showList: opts.showList });
	}
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

	const box = pane.createDiv({ cls: "lists-add" });
	box.toggleClass("is-expanded", expanded);

	const top = box.createDiv({ cls: "lists-add-top" });
	const icon = top.createDiv({ cls: "lists-add-icon" });
	setIcon(icon, "plus");

	const title = top.createEl("input", {
		type: "text",
		cls: "lists-add-input",
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
			ctx.render();
		} else {
			title.focus();
		}
	};

	const expand = () => {
		if (ctx.state.composing) return;
		ctx.state.composing = true;
		ctx.render();
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
			ctx.render();
		}
	});

	if (!expanded) return;

	/* --- expanded: description + actions --- */
	description = box.createEl("textarea", {
		cls: "lists-add-note",
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
			ctx.render();
		}
	});

	const actions = box.createDiv({ cls: "lists-add-actions" });

	const cancel = actions.createEl("button", {
		cls: "lists-add-cancel",
		text: "Cancel",
	});
	cancel.addEventListener("click", () => {
		ctx.state.composing = false;
		ctx.render();
	});

	const add = actions.createEl("button", { cls: "mod-cta", text: "Add task" });
	add.addEventListener("click", () => void commit(false));
}
