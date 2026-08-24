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
};

const noop = async () => undefined;
const mutator = new Proxy({}, { get: () => noop }) as ViewContext["mutator"];

function ctxFor(root: HTMLElement, wide: boolean): ViewContext {
	return {
		app: { workspace: { openLinkText: noop } } as unknown as ViewContext["app"],
		store: store as unknown as ViewContext["store"],
		mutator,
		settings: { ...DEFAULT_SETTINGS },
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
	};
}

function paint(): void {
	// Desktop: all three panes.
	const desk = document.getElementById("desktop") as HTMLElement;
	desk.className = "lists-root is-wide";
	desk.textContent = "";
	const dshell = desk.createDiv({ cls: "lists-shell" });
	const dctx = ctxFor(desk, true);
	renderListsPane(dshell, dctx);
	renderTasksPane(dshell, dctx);
	renderDetailPane(dshell, dctx);

	// Mobile: one pane at a time, three phones side by side.
	for (const [id, pane] of [
		["m-nav", "nav"],
		["m-tasks", "tasks"],
		["m-detail", "detail"],
	] as [string, PaneName][]) {
		const el = document.getElementById(id) as HTMLElement;
		el.className = "lists-root is-narrow";
		el.textContent = "";
		const shell = el.createDiv({ cls: "lists-shell" });
		const saved = state.pane;
		state.pane = pane;
		const c = ctxFor(el, false);
		if (pane === "nav") renderListsPane(shell, c);
		if (pane === "tasks") renderTasksPane(shell, c);
		if (pane === "detail") renderDetailPane(shell, c);
		state.pane = saved;
	}
}

paint();
(window as unknown as { paint: () => void }).paint = paint;
