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
import { SortKey, partitionCompleted, sortTasks } from "../src/model/sort";

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
};

let sortKey: SortKey = "custom";

const noop = async () => undefined;
const mutator = new Proxy({}, { get: () => noop }) as ViewContext["mutator"];

let importanceMode: "star" | "stars5" = "star";

function ctxFor(root: HTMLElement, wide: boolean): ViewContext {
	return {
		app: { workspace: { openLinkText: noop } } as unknown as ViewContext["app"],
		store: store as unknown as ViewContext["store"],
		mutator,
		settings: { ...DEFAULT_SETTINGS, importanceMode },
		state,
		wide,
		render: () => paint(),
		save: noop,
		select: (sel: Selection) => {
			state.selection = sel;
			state.selectedTask = null;
			if (!wide) state.pane = "tasks";
			paint();
		},
		selectTask: (t: Task | null) => {
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
	};
}

/** Render the base layer plus, optionally, the detail overlay. */
function renderInto(
	el: HTMLElement,
	wide: boolean,
	pane: PaneName,
	withOverlay: boolean
): void {
	el.className = `lv-root ${wide ? "is-wide" : "is-narrow"}`;
	el.textContent = "";
	const shell = el.createDiv({ cls: "lv-shell" });
	const ctx = ctxFor(el, wide);

	if (wide) {
		renderListsPane(shell, ctx);
		renderTasksPane(shell, ctx);
	} else if (pane === "nav") {
		renderListsPane(shell, ctx);
	} else {
		renderTasksPane(shell, ctx);
	}

	if (withOverlay) {
		const backdrop = shell.createDiv({ cls: "lv-backdrop is-open" });
		const overlay = shell.createDiv({ cls: "lv-overlay is-open" });
		renderDetailPane(overlay, ctx);
		void backdrop;
	}
}

function paint(): void {
	// Desktop, two columns, detail sliding over the task list.
	renderInto(document.getElementById("desktop") as HTMLElement, true, "tasks", true);

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
