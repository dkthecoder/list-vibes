import { App } from "obsidian";
import { ListStore, SmartView } from "../model/store";
import { Mutator } from "../model/mutate";
import { ListsSettings } from "../settings";
import { ListColor, Task, TaskMeta, ViewMode } from "../model/types";
import type { RenderScope } from "./ListsView";
import { SortKey } from "../model/sort";

export type Selection =
	| { kind: "list"; path: string }
	| { kind: "smart"; view: SmartView };

/** Which pane is showing when the view is too narrow for all three. */
export type PaneName = "nav" | "tasks" | "detail";

export interface ViewState {
	selection: Selection;
	/** Selected task, held by file and line so it survives a reparse. */
	selectedTask: { filePath: string; line: number } | null;
	pane: PaneName;
	completedOpen: boolean;
	/** True while the add box is expanded into its title + description form. */
	composing: boolean;
	/** Which detail action row is expanded, so only one opens at a time. */
	openAction: string | null;
	/**
	 * Metadata staged on the add box before the task exists.
	 *
	 * A new task has no line to splice into yet, so the chips cannot write as
	 * they are tapped the way the detail panel's do. They collect here and are
	 * written once, with the task, in a single edit — which also means an
	 * abandoned compose leaves nothing behind.
	 */
	draft: Partial<TaskMeta>;
}

export interface ViewContext {
	app: App;
	store: ListStore;
	mutator: Mutator;
	settings: ListsSettings;
	state: ViewState;
	/** True when all three panes fit side by side. */
	wide: boolean;
	/** True when this pane is a list on its own, with the picker in the sidebar. */
	listOnly: boolean;
	/** Bring the sidebar picker into view. Only meaningful when `listOnly`. */
	showPicker: () => void;
	/** True when the detail panel is a fixed column rather than an overlay. */
	detailPinned: boolean;
	/** Pin or unpin the detail panel. */
	setDetailPinned: (pinned: boolean) => void;
	/** Repaint everything. */
	/**
	 * Repaint. Name the narrowest scope that covers what changed — "detail" for
	 * anything inside the task detail panel, "tasks" for the list itself. "all"
	 * rebuilds the whole tree and is only right when the layout shape changes.
	 */
	render: (scope?: RenderScope) => void;
	/** Persist settings, e.g. after remembering the last opened list. */
	save: () => Promise<void>;
	select: (sel: Selection) => void;
	selectTask: (task: Task | null) => void;
	showPane: (pane: PaneName) => void;
	/** Open a selection as its own tab in the main workspace. */
	openInNewTab: (sel: Selection) => void;
	/** Sort for the current list: per-list choice, then frontmatter, then default. */
	sortKey: () => SortKey;
	setSortKey: (key: SortKey) => void;

	/** Rows or the post-it wall, for the current list. */
	viewMode: () => ViewMode;
	setViewMode: (mode: ViewMode) => void;
	/**
	 * The layout a list starts in when it has not chosen one. Exposed to the
	 * view so the choice can be made from the list you are looking at, rather
	 * than only from a settings page two screens away.
	 */
	defaultViewMode: () => ViewMode;
	setDefaultViewMode: (mode: ViewMode) => void;

	/** Colour is a property of the list, so it lives in its frontmatter. */
	setColor: (path: string, color: ListColor | null) => void;
	setIcon: (path: string, icon: string | null) => void;

	/** The list's name is its filename, so this renames the file. */
	renameList: (path: string, name: string) => void;
}

export function sameSelection(a: Selection, b: Selection): boolean {
	if (a.kind !== b.kind) return false;
	return a.kind === "list" && b.kind === "list"
		? a.path === b.path
		: a.kind === "smart" && b.kind === "smart" && a.view === b.view;
}

export const SMART_VIEWS: {
	id: SmartView;
	label: string;
	icon: string;
}[] = [
	{ id: "myday", label: "My Day", icon: "sun" },
	{ id: "important", label: "Important", icon: "star" },
	{ id: "planned", label: "Planned", icon: "calendar" },
	{ id: "all", label: "Tasks", icon: "list-todo" },
];
