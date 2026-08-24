import { Menu, setIcon } from "obsidian";
import { SMART_VIEWS, ViewContext } from "../context";
import { Task, isComplete } from "../../model/types";
import { renderTaskRow } from "../../ui/TaskRow";
import { todayISO } from "../../model/store";

/**
 * Middle pane: the tasks of the current selection, with the completed ones
 * grouped into a collapsible section beneath, and an add box at the bottom.
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
		if (list?.config.icon) titleWrap.createSpan({ cls: "lists-header-icon", text: list.config.icon });
		titleWrap.createSpan({ text: list?.name ?? "List" });
	}

	if (!isSmart && list) {
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
					.setTitle(
						ctx.state.completedOpen ? "Hide completed" : "Show completed"
					)
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

	const tasks: Task[] = isSmart
		? ctx.store.getSmartView(sel.view)
		: (list?.tasks ?? []);

	const open = tasks.filter((t) => !isComplete(t));
	const done = tasks.filter((t) => isComplete(t));

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

	// Group by the file's own ## headings, preserving file order.
	renderGrouped(scroll, open, ctx, isSmart);

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

/** Render tasks grouped under their source headings, in file order. */
function renderGrouped(
	scroll: HTMLElement,
	tasks: Task[],
	ctx: ViewContext,
	showList: boolean
): void {
	let current: string | undefined | null = null;
	let container: HTMLElement = scroll;

	for (const t of tasks) {
		if (!showList && t.section !== current) {
			current = t.section;
			if (t.section) {
				scroll.createDiv({ cls: "lists-section", text: t.section });
			}
			container = scroll.createDiv({ cls: "lists-group" });
		} else if (container === scroll) {
			container = scroll.createDiv({ cls: "lists-group" });
		}
		renderTaskRow(container, t, ctx, { showList });
	}
}

function renderAddBox(pane: HTMLElement, ctx: ViewContext): void {
	const sel = ctx.state.selection;
	const box = pane.createDiv({ cls: "lists-add" });

	const icon = box.createDiv({ cls: "lists-add-icon" });
	setIcon(icon, "plus");

	const input = box.createEl("input", {
		type: "text",
		cls: "lists-add-input",
		attr: { placeholder: "Add a task", "aria-label": "Add a task" },
	});

	const submit = async () => {
		const value = input.value.trim();
		if (!value) return;
		input.value = "";

		if (sel.kind === "list") {
			await ctx.mutator.addTask(sel.path, value);
		} else {
			// From My Day, the task needs a home. Use the first list, and flag it.
			const first = ctx.store.getLists()[0];
			if (!first) return;
			await ctx.mutator.addTask(first.path, value, {
				myDay: true,
				due: todayISO(),
			});
		}
		input.focus();
	};

	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			void submit();
		}
		if (e.key === "Escape") input.value = "";
	});
}
