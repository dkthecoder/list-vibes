/**
 * Browser harness. Renders the real pane code against fixture data so the UI
 * can be inspected and screenshotted without an Obsidian install.
 */
import { installDomHelpers } from "./obsidian-mock";
import { FILES } from "./fixtures";
import { parseFile } from "../src/model/parse";
import { Task, TaskList, isComplete } from "../src/model/types";
import { DEFAULT_SETTINGS } from "../src/settings";
import { PaneName, Selection, ViewContext, ViewState } from "../src/views/context";
import { renderListsPane } from "../src/views/panes/ListsPane";
import { renderTasksPane } from "../src/views/panes/TasksPane";
import { renderDetailPane } from "../src/views/panes/DetailPane";
import { todayISO } from "../src/model/store";
import { SortKey } from "../src/model/sort";
import { ListColor, ViewMode } from "../src/model/types";
import { keyboardOverlap } from "../src/views/keyboard";
import { bindSwipeDismiss } from "../src/ui/swipeDismiss";

installDomHelpers();

/* ---- Rebuild fixtures with dates relative to today, so "Today" and
       "Overdue" actually render in the screenshots. ---- */
function shift(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() + days);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const FIXED: Record<string, string> = {};
for (const [path, content] of Object.entries(FILES)) {
	FIXED[path] = content
		.replace(/2026-08-24/g, todayISO())
		.replace(/2026-08-25/g, shift(1))
		.replace(/2026-08-20/g, shift(-4))
		.replace(/2026-08-18/g, shift(-6));
}

const lists: TaskList[] = Object.entries(FIXED).map(([path, content]) =>
	parseFile(content, path)
);
// One list customised, the rest on the theme accent, so both are visible.
const work = lists.find((l) => l.path.includes("Work To-Dos"));
if (work) work.config.color = "teal";
const shows = lists.find((l) => l.path.includes("Movies"));
if (shows) shows.config.color = "pink";

/* ---- A store standing in for ListStore, same shape ---- */
const store = {
	getFolder: () => "lists",
	getLists: () =>
		[...lists].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
	getList: (p: string) => lists.find((l) => l.path === p),
	findTask: (p: string, line: number) =>
		lists.find((l) => l.path === p)?.all.find((t) => t.line === line),
	getSmartView(view: string): Task[] {
		const roots = this.getLists().flatMap((l) => l.tasks);
		const open = roots.filter((t) => !isComplete(t));
		if (view === "myday") return open.filter((t) => t.meta.myDay || t.meta.due === todayISO());
		if (view === "important")
			return open.filter((t) => t.meta.priority === "high" || t.meta.priority === "highest");
		if (view === "planned")
			return open.filter((t) => t.meta.due || t.meta.scheduled);
		return roots;
	},
	countSmartView(view: string) {
		return this.getSmartView(view).filter((t: Task) => !isComplete(t)).length;
	},
};

const state: ViewState = {
	selection: { kind: "list", path: "lists/💼Work To-Dos.md" },
	selectedTask: { filePath: "lists/💼Work To-Dos.md", line: 7 },
	pane: "tasks",
	completedOpen: false,
	composing: false,
	openAction: null,
	draft: {},
};

let sortKey: SortKey = "custom";
let viewMode: ViewMode = "list";
let pinned = false;

const noop = async () => undefined;
/* Record what a drag actually asked for, so the browser test can assert on it
   rather than on pixels. */
const calls: unknown[][] = [];
(window as unknown as { lvCalls: unknown[][] }).lvCalls = calls;
const mutator = new Proxy(
	{},
	{
		get:
			(_t, name) =>
			async (...args: unknown[]) => {
				calls.push([String(name), ...args]);
				return undefined;
			},
	}
) as ViewContext["mutator"];
void noop;

let importanceMode: "star" | "stars5" = "star";

function ctxFor(root: HTMLElement, wide: boolean): ViewContext {
	return {
		app: { workspace: { openLinkText: noop } } as unknown as ViewContext["app"],
		store: store as unknown as ViewContext["store"],
		mutator,
		settings: { ...DEFAULT_SETTINGS, importanceMode },
		state,
		wide,
		listOnly: false,
		detailPinned: pinned,
		setDetailPinned: () => undefined,
		showPicker: () => undefined,
		render: () => paint(),
		save: noop,
		select: (sel: Selection) => {
			state.selection = sel;
			state.selectedTask = null;
			if (!wide) state.pane = "tasks";
			// Mirrors ListsView: picking a list moves the highlight in place rather
			// than repainting the picker. Repainting here would destroy the row
			// under the pointer, and the harness would then hide the very bug that
			// behaviour exists to avoid.
			calls.push(["select", sel]);
			markSelected();
		},
		selectTask: (t: Task | null) => {
			// Recorded as well as applied: a drag that ends in an unwanted tap
			// shows up here and nowhere else, since the panel it opens is empty
			// and an empty panel is hard to tell from no panel.
			calls.push(["selectTask", t ? t.title : null]);
			state.selectedTask = t ? { filePath: t.filePath, line: t.line } : null;
			paint();
		},
		showPane: (p: PaneName) => {
			state.pane = p;
			paint();
		},
		sortKey: () => sortKey,
		setSortKey: (k: SortKey) => {
			sortKey = k;
			paint();
		},
		viewMode: () => viewMode,
		setViewMode: (m: ViewMode) => {
			viewMode = m;
			paint();
		},
		defaultViewMode: () => "list",
		setDefaultViewMode: () => undefined,
		setColor: (p: string, c: ListColor | null) => {
			calls.push(["setColor", p, c]);
		},
		setIcon: (p: string, i: string | null) => {
			calls.push(["setIcon", p, i]);
		},
		promote: (t: Task) => {
			calls.push(["promote", t.title]);
		},
		renameList: (p: string, n: string) => {
			calls.push(["renameList", p, n]);
		},
	};
}

/** Render the base layer plus, optionally, the detail overlay. */
function renderInto(
	el: HTMLElement,
	wide: boolean,
	pane: PaneName,
	withOverlay: boolean
): void {
	/*
	 * The frame is a workspace leaf and the view goes *inside* it, rather than
	 * the two being the same element.
	 *
	 * That distinction is the whole point of this harness now: Obsidian paints
	 * the leaf, the plugin's panes paint nothing, and a harness that collapses
	 * the two cannot tell a view that inherits its background from one that
	 * paints its own. The frame keeps whatever classes the page gave it —
	 * `mod-root` marks a leaf in the main workspace, its absence a sidebar one.
	 */
	el.textContent = "";
	const root = el.createDiv({ cls: `lv-root ${wide ? "is-wide" : "is-narrow"}` });
	const shell = root.createDiv({ cls: "lv-shell" });
	const ctx = ctxFor(root, wide);

	if (wide) {
		renderListsPane(shell, ctx);
		renderTasksPane(shell, ctx);
	} else if (pane === "nav") {
		renderListsPane(shell, ctx);
	} else {
		renderTasksPane(shell, ctx);
	}

	if (withOverlay && pinned) {
		const panel = shell.createDiv({ cls: "lv-overlay is-pinned is-open" });
		renderDetailPane(panel, ctx);
	} else if (withOverlay) {
		const backdrop = shell.createDiv({ cls: "lv-backdrop is-open" });
		const overlay = shell.createDiv({ cls: "lv-overlay is-open" });
		renderDetailPane(overlay, ctx);
		// The real gesture, on the real element. Whether a drag becomes a swipe
		// is unit-tested; whether the panel actually follows a finger depends on
		// touch-action, pointer capture and the transition, none of which a unit
		// test can see.
		bindSwipeDismiss(overlay, backdrop, () => {
			overlay.remove();
			backdrop.remove();
			(window as unknown as { lvDismissed: number }).lvDismissed =
				((window as unknown as { lvDismissed?: number }).lvDismissed ?? 0) + 1;
		});
	}
}

/** Move the picker highlight without a repaint, as the real view does. */
function markSelected(): void {
	const key = state.selection.kind === "list"
		? `list:${state.selection.path}`
		: `smart:${state.selection.view}`;
	document.querySelectorAll<HTMLElement>(".lv-nav-row[data-lv-sel]").forEach((el) => {
		el.toggleClass("is-selected", el.dataset.lvSel === key);
	});
}

function paint(): void {
	// Desktop, two columns, detail sliding over the task list.
	renderInto(document.getElementById("desktop") as HTMLElement, true, "tasks", true);

	// The post-it wall, the Google Keep-style layout.
	viewMode = "postit";
	const savedSel = state.selectedTask;
	state.selectedTask = null;
	renderInto(document.getElementById("cards") as HTMLElement, true, "tasks", false);
	viewMode = "list";
	state.selectedTask = savedSel;

	// File order with nothing selected: the only state in which rows can be
	// dragged, and the one the drag harness drives.
	const dragSel = state.selectedTask;
	state.selectedTask = null;
	renderInto(document.getElementById("drag") as HTMLElement, true, "tasks", false);
	state.selectedTask = dragSel;

	// The detail panel pinned open as a column rather than sliding over.
	pinned = true;
	renderInto(document.getElementById("pinned") as HTMLElement, true, "tasks", true);
	pinned = false;

	// The detail panel with an action row expanded inline.
	state.openAction = "due";
	renderInto(document.getElementById("picker") as HTMLElement, true, "tasks", true);
	state.openAction = null;

	// Desktop with no task selected: 1-5 rating mode and the add box expanded.
	const wasComposing = state.composing;
	const savedTask = state.selectedTask;
	state.composing = true;
	state.selectedTask = null;
	importanceMode = "stars5";
	sortKey = "importance";
	renderInto(document.getElementById("desktop2") as HTMLElement, true, "tasks", false);
	importanceMode = "star";
	sortKey = "custom";
	state.composing = wasComposing;
	state.selectedTask = savedTask;

	// Phone: lists, then a list, then the detail panel over it.
	renderInto(document.getElementById("m-nav") as HTMLElement, false, "nav", false);
	renderInto(document.getElementById("m-tasks") as HTMLElement, false, "tasks", false);
	renderInto(document.getElementById("m-detail") as HTMLElement, false, "tasks", true);
}

paint();
(window as unknown as { paint: () => void }).paint = paint;

/*
 * The real measurement code, exposed so a suite can apply the same number the
 * view would rather than a number a suite made up. The clamp inside it is the
 * thing that stops an over-large reading from pushing every row out of its
 * scroller, and a harness that bypasses it would be testing nothing.
 */
(window as unknown as { lvKeyboardOverlap: typeof keyboardOverlap }).lvKeyboardOverlap =
	keyboardOverlap;
