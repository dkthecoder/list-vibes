import { Menu, setIcon } from "obsidian";
import { SMART_VIEWS, ViewContext } from "../context";
import {
	ListSection,
	Priority,
	Task,
	TaskList,
	ViewMode,
} from "../../model/types";
import { renderTaskRow } from "../../ui/TaskRow";
import { renderTaskCard } from "../../ui/TaskCard";
import { makeDragSortable } from "../../ui/dragSort";
import { editName, makeEditableName } from "../../ui/editableName";
import { renderAddButton, submitOnEnter } from "../../ui/addButton";
import { prettifyName } from "../../ui/prettify";
import { autoGrow } from "../../ui/autoGrow";
import { formatDate, todayISO } from "../../model/store";
import {
	SORT_OPTIONS,
	STARS_BY_PRIORITY,
	partitionCompleted,
	partitionStarred,
	sortTasks,
} from "../../model/sort";

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

	/* ---------------- header ----------------
	 *
	 * `.nav-header` > `.nav-buttons-container` is the toolbar Obsidian's own
	 * File Explorer, Search, Bookmarks and Outline share, and on a phone core
	 * moves it to the bottom of a drawer for thumb reach — behaviour we inherit
	 * by using the same classes.
	 *
	 * The title is only ours to draw when Obsidian is not already drawing it.
	 * In a main-area tab it is, on every platform, and on a phone always — which
	 * is what put two stacked titles on screen. */
	const header = pane.createDiv({ cls: "nav-header lv-header" });

	/*
	 * A way back to the picker. In a narrow pane that is the other half of this
	 * view; in a tab the picker lives in the sidebar, so the same control reveals
	 * it. Without this a tab opened from the sidebar is a dead end whenever the
	 * sidebar itself has been closed.
	 *
	 * Created before the title and outside the button group, so it reads as the
	 * leading control rather than joining the trailing ones.
	 */
	/*
	 * Not on a phone in a tab, where core already draws one.
	 *
	 * The job of this control depends on where the view is. In a narrow pane it
	 * moves between the two halves of the view; in a tab it reveals the sidebar
	 * that holds the picker. On a phone that second job is already done by the
	 * drawer button core puts in the top-left of its own header, two rows above
	 * — so ours was a second back arrow doing the same thing, in a bar that is
	 * short of room to begin with. The first job has no equivalent, so it stays.
	 */
	const coreHasDrawerButton =
		ctx.listOnly && parent.ownerDocument.body.classList.contains("is-mobile");
	if ((!ctx.wide || ctx.listOnly) && !coreHasDrawerButton) {
		const back = header.createDiv({
			cls: "clickable-icon nav-action-button lv-back",
		});
		setIcon(back, "chevron-left");
		back.setAttribute("aria-label", "Back to lists");
		back.addEventListener("click", () =>
			ctx.listOnly ? ctx.showPicker() : ctx.showPane("nav")
		);
	}

	{
		/*
		 * The title is always built, and CSS decides whether it shows.
		 *
		 * Whether Obsidian is drawing a title of its own is not something this
		 * code can know: `.view-header` is hidden in a sidebar, shown in a
		 * main-area tab, always shown on a phone — and hidden again on desktop
		 * if the user has turned "show tab title bar" off, which is a setting
		 * that can change while the view is open. Deciding here got that last
		 * case wrong and left the list unnamed. A stylesheet can express the
		 * whole condition, and re-evaluates it for free.
		 */
		const titleWrap = header.createDiv({ cls: "lv-header-title" });
		if (isSmart) {
			const v = SMART_VIEWS.find((s) => s.id === sel.view);
			titleWrap.createSpan({ text: v?.label ?? "Tasks" });
		} else if (list) {
			// The icon is a button whether or not there is one yet, so a list
			// without an icon still offers somewhere to set one.
			const iconEl = titleWrap.createSpan({
				cls: "lv-header-icon",
				text: list.config.icon ?? "",
			});
			iconEl.toggleClass("is-empty", !list.config.icon);
			iconEl.setAttribute("role", "button");
			iconEl.setAttribute("tabindex", "0");
			iconEl.setAttribute(
				"aria-label",
				list.config.icon ? "Change icon" : "Add an icon"
			);
			if (!list.config.icon) setIcon(iconEl, "smile-plus");
			iconEl.addEventListener("click", (e) => {
				e.stopPropagation();
				void pickIcon(ctx, list);
			});
			iconEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					void pickIcon(ctx, list);
				}
			});

			// The name IS the filename, so editing it here renames the file. Same
			// implementation as the picker rows, which are armed on demand instead.
			const nameEl = titleWrap.createSpan({ cls: "lv-header-name" });
			makeEditableName(nameEl, {
				value: list.name,
				// Tidied for the title, never for the rename: `display` is what
				// sits there, `value` is what appears the moment you click in.
				display: ctx.settings.prettyTitles ? prettifyName(list.name) : list.name,
				alwaysEditable: true,
				onCommit: (next) => ctx.renameList(list.path, next),
			});
		} else {
			titleWrap.createSpan({ text: "List" });
		}
	}

	const buttons = header.createDiv({
		cls: "nav-buttons-container lv-header-actions",
	});

	if (!isSmart && list) {
		const sortKey = ctx.sortKey();
		const current = SORT_OPTIONS.find((o) => o.key === sortKey);

		const sortBtn = buttons.createDiv({
			cls: "clickable-icon nav-action-button lv-header-action",
		});
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
		const layout = buttons.createDiv({
			cls: "clickable-icon nav-action-button lv-header-action",
		});
		layout.toggleClass("is-active", mode === "postit");
		setIcon(layout, mode === "postit" ? "layout-grid" : "list");
		layout.setAttribute(
			"aria-label",
			mode === "postit" ? "Switch to rows" : "Switch to post-it view"
		);
		layout.addEventListener("click", () =>
			ctx.setViewMode(mode === "postit" ? "list" : "postit")
		);

		const more = buttons.createDiv({
			cls: "clickable-icon nav-action-button lv-header-action",
		});
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
					.onClick(() => editName(header))
			);
			menu.addItem((i) =>
				i
					.setTitle("Change icon")
						.setIcon("smile")
						.onClick(() => void pickIcon(ctx, list))
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
					.setTitle("New group")
					.setIcon("heading")
					.onClick(() => {
						void import("../../ui/PromptModal").then(({ PromptModal }) => {
							new PromptModal(ctx.app, {
								title: "New group",
								placeholder: "Group name",
								cta: "Add",
								onSubmit: (name) => void ctx.mutator.createSection(list.path, name),
							}).open();
						});
					})
			);
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
	 * Post-it mode used to be excluded because the wall wraps into a grid and a
	 * vertical drag preview cannot describe a move in two dimensions. It no
	 * longer has to: a drop is now a run picked by hit-test plus an index within
	 * it, so neither half of the arithmetic thinks in two dimensions.
	 */
	const sortable = sortKey === "custom" && !isSmart;
	renderTasks(scroll, open, ctx, {
		grouped,
		showList: isSmart,
		mode,
		sortable,
		sections: list?.sections ?? [],
		path: list?.path ?? "",
		starredFirst: ctx.settings.starredSection,
	});

	// A list decides for itself; absent, the setting decides. Post-it view is
	// cards rather than rows, so there is nothing to alternate.

	/* ---------------- add box ---------------- */
	if (!isSmart || sel.view === "myday") {
		/*
		 * The next row in the list, above Completed.
		 *
		 * It was a bar pinned to the foot of the pane, which put a gulf of empty
		 * pane between the last task and the box you add the next one into. Here
		 * it sits where the task it is about to make will sit, and the Completed
		 * section closes the list beneath it.
		 *
		 * Being inside the scroller is also what lets a keyboard be scrolled
		 * clear of: a bar outside every scroller cannot be, which is the reason
		 * this lived here once before.
		 *
		 * `simple` is a separate question from where it lives, and stays: on
		 * touch the box is one line, because expanding a description field, five
		 * chips and two buttons under a keyboard covering half the screen is not
		 * what tapping "add a task" was asking for.
		 *
		 * Read off `is-mobile` on the body rather than `Platform`, because that
		 * is the same signal the stylesheet keys off — so the two can never
		 * disagree — and because it follows Obsidian's desktop mobile emulation,
		 * which makes this testable without a phone.
		 */
		const touch = pane.ownerDocument.body.classList.contains("is-mobile");
		renderAddBox(scroll, ctx, touch, list?.sections ?? []);
	}

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
				// Completed is never grouped — it is a filtered subset of the
				// file — so a task here has left its heading behind and has to
				// carry it.
				const o = { showList: isSmart, showSection: true };
				if (mode === "postit") renderTaskCard(body, t, ctx, o);
				else renderTaskRow(body, t, ctx, o);
			}
		}
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
		/** The list's headings, for naming the section a drop lands in. */
		sections: ListSection[];
		/** The list file, for the section edits the headings offer. */
		path: string;
		/** Lift starred tasks into a band above everything else. */
		starredFirst: boolean;
	}
): void {
	const postit = opts.mode === "postit";
	const path = opts.path;
	const cls = postit ? "lv-group lv-postit" : "lv-group";
	const draw = (parent: HTMLElement, t: Task) =>
		postit
			? renderTaskCard(parent, t, ctx, {
					showList: opts.showList,
					showSection: !opts.grouped,
				})
			: renderTaskRow(parent, t, ctx, {
					showList: opts.showList,
					showSection: !opts.grouped,
				});

	/**
	 * Every run on screen, built first and wired afterwards.
	 *
	 * A run used to be wired the moment it was finished, because a drag stayed
	 * inside the group it started in. Crossing a heading is now deliberate
	 * rather than an accident to be prevented, and a row cannot be told about
	 * runs that have not been drawn yet — so the drawing and the wiring are two
	 * passes.
	 */
	const runs: { el: HTMLElement; tasks: Task[]; rows: HTMLElement[] }[] = [];

	/**
	 * The heading a run sits under, found by line rather than by name.
	 *
	 * Two sections may be called the same thing, so the last heading above the
	 * run's first task is the only honest answer.
	 */
	const sectionLineFor = (run: Task[]): number | null => {
		const first = run[0];
		if (!first) return null;
		let found: number | null = null;
		for (const sec of opts.sections) {
			if (sec.line > first.line) break;
			found = sec.line;
		}
		return found;
	};

	const wire = () => {
		if (!opts.sortable) return;
		const containers = () => runs.map((r) => ({ el: r.el, rows: r.rows }));

		for (const run of runs) {
			// A lone row in a lone run has nowhere to go.
			if (run.tasks.length < 2 && runs.length < 2) continue;

			run.rows.forEach((row, index) => {
				row.addClass("lv-sortable");
				makeDragSortable(row, {
					index,
					siblings: () => run.rows,
					containers,
					onDrop: (from, to) => void ctx.mutator.reorder(run.tasks[from], run.tasks, to),
					onDropAcross: (toContainer, toIndex) => {
						const dest = runs[toContainer];
						if (!dest) return;
						void ctx.mutator.moveToSection(
							run.tasks[index],
							dest.tasks,
							toIndex,
							sectionLineFor(dest.tasks)
						);
					},
				});
			});
		}
	};

	if (!opts.grouped) {
		const el = scroll.createDiv({ cls });
		runs.push({ el, tasks, rows: tasks.map((t) => draw(el, t)) });
		wire();
		return;
	}

	/*
	 * Walked by heading rather than by run of tasks.
	 *
	 * Grouping the tasks would skip a section that has none, and an empty
	 * section has to be on screen or it can never be dropped into — which would
	 * make creating one a dead end. Bounds come from the headings' own lines, so
	 * two sections sharing a name stay separate.
	 */
	const bounds = opts.sections.map((sec, i) => ({
		...sec,
		end: opts.sections[i + 1]?.line ?? Infinity,
	}));

	const addRun = (run: Task[]) => {
		const el = scroll.createDiv({ cls });
		runs.push({ el, tasks: run, rows: run.map((t) => draw(el, t)) });
	};

	/*
	 * Starred first, in a band of its own.
	 *
	 * Lifted out before anything else is grouped, so a starred task appears once
	 * — at the top — rather than twice. Where it came from is not lost: it is
	 * shown away from its heading, so it carries the heading's name as a badge,
	 * which is the same rule Completed already follows.
	 *
	 * Nothing is drawn when nothing is starred. A band that is always there but
	 * usually empty is a row of furniture, and the setting exists for people who
	 * would rather their own order were the only order.
	 */
	let remaining = tasks;
	if (opts.starredFirst) {
		const { starred, rest } = partitionStarred(tasks);
		if (starred.length) {
			scroll.createDiv({ cls: "lv-section lv-section-starred", text: "Starred" });
			// Named, so the band can be told from a section's own run — by a
			// stylesheet, and by a test that means to drive one and not the other.
			const el = scroll.createDiv({ cls: `${cls} lv-starred-run` });
			runs.push({
				el,
				tasks: starred,
				rows: starred.map((t) =>
					postit
						? renderTaskCard(el, t, ctx, { showList: opts.showList, showSection: true })
						: renderTaskRow(el, t, ctx, { showList: opts.showList, showSection: true })
				),
			});
			remaining = rest;
		}
	}

	const firstHeading = bounds[0]?.line ?? Infinity;
	const loose = remaining.filter((t) => t.line < firstHeading);
	// The space above the first heading is a run whether or not anything is in
	// it, so a task can always be dragged back out of every section.
	if (loose.length || bounds.length) addRun(loose);

	const heads: HTMLElement[] = [];
	for (const sec of bounds) {
		const folded = ctx.sectionCollapsed(path, sec.name);
		const mine = remaining.filter((t) => t.line > sec.line && t.line < sec.end);
		heads.push(renderSectionHead(scroll, ctx, path, sec, mine.length, folded));
		if (folded) continue;
		addRun(mine);
	}

	/*
	 * Headings are their own drag group, and a one-dimensional one.
	 *
	 * A section moves among sections; there is nowhere else for it to go, so the
	 * container hit-test the rows need would only ever return the one answer.
	 * Only the heading moves under the pointer — its tasks travel with it in the
	 * file, not on screen — because shifting a whole band would mean animating
	 * every row in it to describe a move that is really about order alone.
	 */
	if (opts.sortable && heads.length > 1) {
		heads.forEach((head, index) => {
			head.addClass("lv-sortable");
			makeDragSortable(head, {
				index,
				siblings: () => heads,
				onDrop: (from, to) => void ctx.mutator.moveSection(path, bounds[from].line, to),
			});
		});
	}

	wire();
}

/**
 * A section's heading: fold control, name, count, and its menu.
 *
 * The name is editable in place for the same reason a list's is — the heading
 * *is* the section, so renaming it here is the honest edit rather than a dialog
 * that writes somewhere you cannot see.
 */
function renderSectionHead(
	scroll: HTMLElement,
	ctx: ViewContext,
	path: string,
	sec: ListSection,
	count: number,
	folded: boolean
): HTMLElement {
	const head = scroll.createDiv({ cls: "lv-section" });
	head.toggleClass("is-collapsed", folded);
	head.setAttribute("aria-expanded", String(!folded));

	const chev = head.createDiv({ cls: "lv-section-chevron" });
	setIcon(chev, folded ? "chevron-right" : "chevron-down");

	const name = head.createDiv({ cls: "lv-section-name", text: sec.name });
	makeEditableName(name, {
		value: sec.name,
		onCommit: (next) => void ctx.mutator.renameSection(path, sec.line, next),
	});

	if (count) head.createDiv({ cls: "lv-section-count", text: String(count) });

	/*
	 * Delete, one click away rather than inside the menu.
	 *
	 * Emptying a board of the columns you no longer want is a normal tidying
	 * pass, and going through a menu for each one is three clicks where it
	 * should be one. An empty section goes without asking — there is nothing to
	 * lose — and one with tasks says where they will end up first.
	 *
	 * It never takes the tasks with it. That is still in the menu, behind its
	 * own confirm, because it is the one version that destroys something.
	 */
	const bin = head.createDiv({ cls: "clickable-icon lv-section-bin" });
	setIcon(bin, "trash-2");
	bin.setAttribute("aria-label", count ? "Delete group, keep its tasks" : "Delete group");
	bin.addEventListener("click", (e) => {
		e.stopPropagation();
		if (!count) {
			void ctx.mutator.removeSection(path, sec.line);
			return;
		}
		void import("../../ui/ConfirmModal").then(({ ConfirmModal }) => {
			new ConfirmModal(ctx.app, {
				title: `Delete "${sec.name}"?`,
				body: `Its ${count} task${count === 1 ? "" : "s"} will move into the group above. Nothing is deleted.`,
				cta: "Delete group",
				destructive: false,
				onConfirm: () => void ctx.mutator.removeSection(path, sec.line),
			}).open();
		});
	});

	const more = head.createDiv({ cls: "clickable-icon lv-section-more" });
	setIcon(more, "more-horizontal");
	more.setAttribute("aria-label", "Group options");
	more.addEventListener("click", (e) => {
		e.stopPropagation();
		showSectionMenu(e, ctx, path, sec, count);
	});

	head.addEventListener("click", () => ctx.toggleSection(path, sec.name));
	return head;
}

/**
 * What a section can have done to it.
 *
 * Deleting keeps the tasks by default and moves them into the section above:
 * removing a grouping should not be a way to lose the things grouped. Taking
 * the tasks too is a separate, confirmed choice.
 */
function showSectionMenu(
	e: MouseEvent,
	ctx: ViewContext,
	path: string,
	sec: ListSection,
	count: number
): void {
	const menu = new Menu();

	menu.addItem((i) =>
		i
			.setTitle("Rename group")
			.setIcon("pencil")
			.onClick(() => {
				void import("../../ui/PromptModal").then(({ PromptModal }) => {
					new PromptModal(ctx.app, {
						title: "Rename group",
						value: sec.name,
						onSubmit: (next) =>
							void ctx.mutator.renameSection(path, sec.line, next),
					}).open();
				});
			})
	);

	menu.addSeparator();

	menu.addItem((i) =>
		i
			.setTitle("Move up")
			.setIcon("arrow-up")
			.onClick(() => void ctx.mutator.moveSectionBy(path, sec.line, -1))
	);
	menu.addItem((i) =>
		i
			.setTitle("Move down")
			.setIcon("arrow-down")
			.onClick(() => void ctx.mutator.moveSectionBy(path, sec.line, 1))
	);

	menu.addSeparator();

	menu.addItem((i) =>
		i
			.setTitle(count ? "Delete group, keep tasks" : "Delete group")
			.setIcon("trash-2")
			.onClick(() => void ctx.mutator.removeSection(path, sec.line))
	);

	if (count) {
		menu.addItem((i) =>
			i
				.setTitle("Delete group and its tasks")
				.setIcon("trash-2")
				.onClick(() => {
					void import("../../ui/ConfirmModal").then(({ ConfirmModal }) => {
						new ConfirmModal(ctx.app, {
							title: `Delete "${sec.name}"?`,
							body: `${count} task${count === 1 ? "" : "s"} will be deleted with it. This cannot be undone from inside the plugin.`,
							cta: "Delete",
							onConfirm: () =>
								void ctx.mutator.removeSection(path, sec.line, { withTasks: true }),
						}).open();
					});
				})
		);
	}

	menu.showAtMouseEvent(e);
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

function renderAddBox(
	pane: HTMLElement,
	ctx: ViewContext,
	simple = false,
	sections: ListSection[] = []
): void {
	const sel = ctx.state.selection;
	// A simple box never expands, so it is never in the expanded state either —
	// including on the paint right after a desktop layout became a touch one.
	const expanded = ctx.state.composing && !simple;

	const box = pane.createDiv({ cls: "lv-add" });
	box.toggleClass("lv-add-simple", simple);
	// Set from state on every render, and toggled live by expand() without one,
	// so a repaint that does land while composing keeps the box open.
	box.toggleClass("is-expanded", expanded);

	const top = box.createDiv({ cls: "lv-add-top" });

	const title = top.createEl("input", {
		type: "text",
		cls: "lv-add-input",
		attr: { placeholder: "Add a task", "aria-label": "Task name" },
	});

	/*
	 * Which section the task lands in.
	 *
	 * Only where there is a choice to make. Adding used to append to the end of
	 * the file, which in a list with headings means whichever section happens to
	 * be last — however far that is from the one being looked at. Shown on the
	 * box rather than inferred from what was last touched: a destination you
	 * cannot see is one you cannot correct before typing.
	 */
	if (sections.length) {
		const chosen = ctx.state.addSection;
		const named =
			chosen === null
				? "No group"
				: (sections.find((x) => x.line === chosen) ?? sections[sections.length - 1]).name;

		const pick = top.createDiv({ cls: "lv-add-section" });
		pick.setText(named);
		pick.setAttribute("aria-label", `Add to ${named}`);
		pick.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			const menu = new Menu();
			menu.addItem((i) =>
				i
					.setTitle("No group")
					.setChecked(chosen === null)
					.onClick(() => {
						ctx.state.addSection = null;
						ctx.render("tasks");
					})
			);
			for (const sec of sections) {
				menu.addItem((i) =>
					i
						.setTitle(sec.name)
						.setChecked(sec.line === chosen)
						.onClick(() => {
							ctx.state.addSection = sec.line;
							ctx.render("tasks");
						})
				);
			}
			menu.showAtMouseEvent(e);
		});
	}
	submitOnEnter(title);

	let description: HTMLTextAreaElement | null = null;

	/**
	 * `override` is the value the + button already took off the field. It clears
	 * the field before calling back — so that a second tap cannot submit the
	 * same text twice — which means the value has to travel rather than be read
	 * again from an input that is now empty.
	 */
	const commit = async (keepOpen: boolean, override?: string) => {
		const value = (override ?? title.value).trim();
		if (!value) return;
		const note = description?.value.trim();

		title.value = "";
		if (description) description.value = "";

		const draft = { ...ctx.state.draft };
		ctx.state.draft = {};

		if (sel.kind === "list") {
			// Absent when the list has no headings, which keeps the old behaviour
			// exactly: the end of the file.
			const section = sections.length
				? (ctx.state.addSection ?? sections[sections.length - 1].line)
				: undefined;
			await ctx.mutator.addTask(sel.path, value, draft, { note, section });
		} else {
			// From My Day a task still needs a home list. Use the first one and flag it.
			const first = ctx.store.getLists()[0];
			if (!first) return;
			await ctx.mutator.addTask(
				first.path,
				value,
				{ myDay: true, due: todayISO(), ...draft },
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

	/*
	 * Expanding is a class, not a repaint.
	 *
	 * This used to call render(), which rebuilt the pane and therefore destroyed
	 * and recreated the very input the user had just tapped. On Android that is
	 * worse than it sounds: text arrives through an IME composition bound to the
	 * live element, and replacing that element mid-composition leaves the IME
	 * inserting at a stale offset — which is why typed characters came out in
	 * reverse. The input now survives, so the composition does too.
	 */
	// Built after `commit` exists and moved to the front, so the DOM order reads
	// "+ then field" while the code reads in dependency order.
	top.prepend(
		renderAddButton(top, {
			cls: "lv-add-icon",
			label: "Add task",
			field: () => title,
			onCommit: (v) => void commit(true, v),
		})
	);

	/*
	 * Focusing the field opens the rich compose — on a desktop.
	 *
	 * On touch it stays one line. The box lives inside the list there, and
	 * expanding it in place shoves a description field, a row of chips and two
	 * buttons into the middle of the scroll under a keyboard that is already
	 * covering half the screen. What you wanted was to type a task. Everything
	 * the expanded box offers is on the task itself once it exists, one tap
	 * away, on a panel built for it.
	 */
	const expand = () => {
		if (simple || ctx.state.composing) return;
		ctx.state.composing = true;
		box.addClass("is-expanded");
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
			ctx.state.draft = {};
			ctx.state.openAction = null;
			ctx.render("tasks");
		}
	});


	/* --- expanded: description, metadata and actions ---
	 *
	 * Always built, revealed by `.is-expanded`. Building it on demand meant a
	 * repaint at exactly the moment the user started typing. */
	description = box.createEl("textarea", {
		cls: "lv-add-note",
		attr: {
			// One row, and as many more as the text needs. `rows="2"` reserved
			// space nobody had used yet and ran out the moment they did.
			rows: "1",
			placeholder: "Add a description",
			"aria-label": "Description",
		},
	});
	autoGrow(description);
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

	renderDraftChips(box, ctx);

	const actions = box.createDiv({ cls: "lv-add-actions" });

	const cancel = actions.createEl("button", { cls: "lv-add-cancel", text: "Cancel" });
	cancel.addEventListener("click", () => {
		ctx.state.composing = false;
		ctx.state.draft = {};
		ctx.state.openAction = null;
		ctx.render("tasks");
	});

	const add = actions.createEl("button", { cls: "mod-cta", text: "Add task" });
	add.addEventListener("click", () => void commit(false));
}

/**
 * The metadata chips on the expanded add box.
 *
 * Everything the detail panel can set on an existing task, except steps — a
 * step has to hang beneath a task that exists, so there is nothing for it to
 * attach to until the task is added.
 *
 * Unlike the detail panel's rows, these write nothing as they are tapped. There
 * is no line to splice yet, so each one stages a value on `state.draft` and the
 * whole lot is written in one edit when the task is added. Abandoning the
 * compose leaves the file untouched.
 */
function renderDraftChips(box: HTMLElement, ctx: ViewContext): void {
	const draft = ctx.state.draft;
	const row = box.createDiv({ cls: "lv-add-chips" });

	const repaint = () => ctx.render("tasks");

	/** A chip that is either off, or on and showing its value. */
	const chip = (o: {
		id: string;
		icon: string;
		label: string;
		value?: string;
		onClick: () => void;
		onClear?: () => void;
	}) => {
		const el = row.createDiv({ cls: "lv-add-chip" });
		el.toggleClass("is-set", !!o.value);
		el.setAttribute("role", "button");
		el.setAttribute("tabindex", "0");
		el.setAttribute("aria-label", o.value ? `${o.label}: ${o.value}` : o.label);
		const ic = el.createDiv({ cls: "lv-add-chip-icon" });
		setIcon(ic, o.icon);
		el.createSpan({ cls: "lv-add-chip-text", text: o.value ?? o.label });
		el.addEventListener("click", (e) => {
			e.stopPropagation();
			o.onClick();
		});
		if (o.value && o.onClear) {
			const x = el.createDiv({ cls: "lv-add-chip-clear" });
			setIcon(x, "x");
			x.setAttribute("aria-label", `Clear ${o.label.toLowerCase()}`);
			x.addEventListener("click", (e) => {
				e.stopPropagation();
				o.onClear?.();
			});
		}
		return el;
	};

	/** Open one inline picker at a time, keyed apart from the detail panel's. */
	const toggleOpen = (id: string) => {
		const key = `add:${id}`;
		ctx.state.openAction = ctx.state.openAction === key ? null : key;
		repaint();
	};
	const isOpen = (id: string) => ctx.state.openAction === `add:${id}`;

	/* --- My Day: a plain toggle, no picker --- */
	chip({
		id: "myday",
		icon: "sun",
		label: "My Day",
		value: draft.myDay ? "My Day" : undefined,
		onClick: () => {
			if (draft.myDay) delete draft.myDay;
			else draft.myDay = true;
			repaint();
		},
		onClear: () => {
			delete draft.myDay;
			repaint();
		},
	});

	chip({
		id: "due",
		icon: "calendar",
		label: "Due",
		value: draft.due ? formatDate(draft.due) : undefined,
		onClick: () => toggleOpen("due"),
		onClear: () => {
			delete draft.due;
			repaint();
		},
	});

	chip({
		id: "reminder",
		icon: "bell",
		label: "Remind",
		value: draft.reminder,
		onClick: () => toggleOpen("reminder"),
		onClear: () => {
			delete draft.reminder;
			repaint();
		},
	});

	chip({
		id: "repeat",
		icon: "repeat",
		label: "Repeat",
		value: draft.repeat,
		onClick: () => toggleOpen("repeat"),
		onClear: () => {
			delete draft.repeat;
			repaint();
		},
	});

	chip({
		id: "important",
		icon: "star",
		label: "Important",
		value: draft.priority ? starLabel(draft.priority) : undefined,
		onClick: () => toggleOpen("important"),
		onClear: () => {
			delete draft.priority;
			repaint();
		},
	});

	/* --- the inline picker for whichever chip is open --- */
	const pick = (
		options: { label: string; apply: () => void }[],
		current?: string
	) => {
		const opts = box.createDiv({ cls: "lv-add-picker" });
		for (const o of options) {
			const b = opts.createDiv({ cls: "lv-chip" });
			b.toggleClass("is-on", o.label === current);
			b.setText(o.label);
			b.setAttribute("role", "button");
			b.setAttribute("tabindex", "0");
			b.addEventListener("click", (e) => {
				e.stopPropagation();
				o.apply();
				ctx.state.openAction = null;
				repaint();
			});
		}
	};

	if (isOpen("due")) {
		pick([
			{ label: "Today", apply: () => (draft.due = todayISO()) },
			{ label: "Tomorrow", apply: () => (draft.due = addDays(1)) },
			{ label: "Next week", apply: () => (draft.due = addDays(7)) },
		]);
	}

	if (isOpen("reminder")) {
		pick(
			["09:00", "12:00", "17:00", "20:00"].map((t) => ({
				label: t,
				apply: () => (draft.reminder = t),
			})),
			draft.reminder
		);
	}

	if (isOpen("repeat")) {
		pick(
			["every day", "every week", "every month", "every year"].map((r) => ({
				label: r,
				apply: () => (draft.repeat = r),
			})),
			draft.repeat
		);
	}

	if (isOpen("important")) {
		const stars: Priority[] = ["lowest", "low", "medium", "high", "highest"];
		pick(
			(ctx.settings.importanceMode === "stars5"
				? stars
				: (["high"] as Priority[])
			).map((p) => ({
				label: starLabel(p),
				apply: () => (draft.priority = p),
			})),
			draft.priority ? starLabel(draft.priority) : undefined
		);
	}
}

/** "★★★★" for a rating, or just "Important" in single-star mode. */
function starLabel(p: Priority): string {
	const n = STARS_BY_PRIORITY[p];
	return "\u2605".repeat(n);
}

/** An ISO date `n` days from today. */
function addDays(n: number): string {
	const d = new Date();
	d.setDate(d.getDate() + n);
	const p = (v: number) => String(v).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function pickIcon(ctx: ViewContext, list: TaskList): Promise<void> {
	const { IconModal } = await import("../../ui/IconModal");
	new IconModal(ctx.app, {
		listName: list.name,
		current: list.config.icon,
		onPick: (icon) => ctx.setIcon(list.path, icon),
	}).open();
}
