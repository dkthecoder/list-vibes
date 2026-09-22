/**
 * Serialising a view's selection.
 *
 * This is what lets a list live in its own workspace tab: Obsidian persists
 * whatever `getState` returns and hands it back to `setState` on restart, so
 * each tab remembers the list it was showing rather than every tab sharing one
 * global "last opened" value.
 *
 * Pure and Obsidian-free so it can be unit-tested.
 */

import { SmartView } from "../model/store";
import { Selection, sameSelection } from "./context";
import { splitIcon } from "../model/parse";
import { ListSection } from "../model/types";

const SMART_VIEWS: SmartView[] = ["myday", "important", "planned", "all"];

export interface SerialisedSelection {
	kind?: string;
	path?: string;
	view?: string;
	/** Obsidian persists this as an open record. */
	[key: string]: unknown;
}

/**
 * The task whose detail panel is open, as part of the view's state.
 *
 * It is here rather than in the view's own memory so that opening a task is a
 * *navigation*. Obsidian records the previous state in the leaf's history, and
 * both its back buttons — the one in the mobile navigation bar and Android's
 * own — run that history backwards. Without this, back from an open detail
 * panel had nothing of ours to undo and went straight past the plugin to
 * whatever was before it, or out of the app.
 *
 * A line number is a weak identifier and deliberately so: it is what the rest
 * of the plugin uses to point at a task, and a stale one resolves to nothing
 * and closes the panel, which is the right failure.
 */
export interface TaskRef {
	filePath: string;
	line: number;
}

export function encodeTaskRef(ref: TaskRef | null): Record<string, unknown> {
	// Absent rather than null: a state blob is persisted into workspace.json,
	// and an absent key reads the same in every version that ever existed.
	return ref ? { taskPath: ref.filePath, taskLine: ref.line } : {};
}

export function decodeTaskRef(state: unknown): TaskRef | null {
	if (!state || typeof state !== "object") return null;
	const s = state as { taskPath?: unknown; taskLine?: unknown };
	if (typeof s.taskPath !== "string" || !s.taskPath.length) return null;
	// A line must be a real index. `0` is valid — the first line of a file —
	// so this cannot be a truthiness check.
	if (typeof s.taskLine !== "number" || !Number.isInteger(s.taskLine) || s.taskLine < 0) {
		return null;
	}
	return { filePath: s.taskPath, line: s.taskLine };
}

export function encodeSelection(sel: Selection): SerialisedSelection {
	return sel.kind === "list"
		? { kind: "list", path: sel.path }
		: { kind: "smart", view: sel.view };
}

/**
 * Read a selection back. Returns null for anything unrecognised — a state blob
 * from an older version, a hand-edited workspace file, or plain undefined —
 * so the caller can fall back rather than render a broken view.
 */
export function decodeSelection(state: unknown): Selection | null {
	if (!state || typeof state !== "object") return null;
	const s = state as SerialisedSelection;

	if (s.kind === "list") {
		return typeof s.path === "string" && s.path.length
			? { kind: "list", path: s.path }
			: null;
	}

	if (s.kind === "smart") {
		const view = SMART_VIEWS.find((v) => v === s.view);
		return view ? { kind: "smart", view } : null;
	}

	return null;
}

/** Tab title for a selection: the list's own name, not the plugin's. */
export function selectionTitle(sel: Selection, listName?: string): string {
	if (sel.kind === "smart") {
		switch (sel.view) {
			case "myday":
				return "My Day";
			case "important":
				return "Important";
			case "planned":
				return "Planned";
			default:
				return "Tasks";
		}
	}
	if (listName) return listName;
	const base = (sel.path.split("/").pop() ?? sel.path).replace(/\.md$/i, "");
	/*
	 * Minus a leading emoji, because that is the list's *icon*.
	 *
	 * Plenty of vaults name files "💼Work.md", and the parser promotes that
	 * emoji to the list's icon and leaves "Work" as the name — so the view shows
	 * an icon and the word. A tab has nowhere to put an icon, and repeating the
	 * emoji in front of the text there made the tab and the view disagree about
	 * what the list was called.
	 */
	return splitIcon(base).name;
}

/**
 * How much of the view a repaint touches.
 *
 * The view used to rebuild everything on every change, and that is what made
 * editing a task flash: a click wrote the file, the vault event came back ~30ms
 * later, and the whole tree — nav, task list, overlay and all — was destroyed
 * and recreated underneath the pointer. Scroll offsets were re-applied after the
 * fact and could clamp, focus was reattached by class name, and the overlay's
 * backdrop restarted its fade from scratch.
 *
 * A repaint now says what it actually affects, and anything it does not name is
 * left on screen untouched.
 */
export type RenderScope = "detail" | "tasks" | "all";

/** Narrowest first. "tasks" also refreshes the detail panel; "all" rebuilds. */
const SCOPE_RANK: Record<RenderScope, number> = { detail: 0, tasks: 1, all: 2 };

/**
 * The wider of two scopes.
 *
 * Repaints are coalesced into one frame, so a frame that has already been asked
 * for a wide repaint must not be narrowed by a later request — a file change
 * landing while a detail row is expanding would otherwise repaint the panel and
 * leave a stale task list behind it. Widening is safe in a way narrowing is not,
 * so ties and conflicts both resolve upward.
 */
export function widerScope(a: RenderScope, b: RenderScope): RenderScope {
	return SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b;
}

/** One open List Vibes tab, as far as the choice below is concerned. */
export interface OpenTab {
	/** What it is showing, or null if its state could not be read. */
	selection: Selection | null;
	pinned: boolean;
}

export type TabChoice =
	| { action: "focus"; index: number }
	| { action: "retarget"; index: number }
	| { action: "new" };

/**
 * Which tab a picked list should open in.
 *
 * Clicking through five lists should leave one tab, not five, so an existing
 * List Vibes tab is retargeted rather than added to. Three rules, in order:
 *
 * 1. A tab already showing this selection is focused — never duplicated, and
 *    this applies to pinned tabs too, since focusing one does not disturb it.
 * 2. Otherwise the first *unpinned* List Vibes tab is retargeted. Pinning is how
 *    an Obsidian user says "this one stays put", and it has to mean the same
 *    here as it does for a note.
 * 3. Failing both, a new tab.
 *
 * Note what is absent: tabs holding *notes* are never candidates. Replacing
 * whatever the user happened to be reading is a much worse surprise than one
 * extra tab, so only our own tabs are ever reused.
 */
export function chooseTab(
	tabs: OpenTab[],
	sel: Selection,
	forceNew = false,
	/**
	 * Never hand an open tab a different list.
	 *
	 * Reuse is what makes a custom view's tab title go stale: the tab is given
	 * another list through `setViewState`, and Obsidian rereads a view's name
	 * when it decides to rather than when its state changes. A tab that is only
	 * ever created or focused is never holding a list it was not built for.
	 *
	 * The cost is a tab per list you visit, which is why it is a choice and not
	 * the default.
	 */
	ownTab = false
): TabChoice {
	if (forceNew) return { action: "new" };

	const showing = tabs.findIndex(
		(t) => t.selection && sameSelection(t.selection, sel)
	);
	if (showing >= 0) return { action: "focus", index: showing };

	if (ownTab) return { action: "new" };

	const free = tabs.findIndex((t) => !t.pinned);
	if (free >= 0) return { action: "retarget", index: free };

	return { action: "new" };
}

/**
 * A stable string identifying a selection, for marking the picker row that is
 * currently open.
 *
 * Selecting a list used to repaint the whole picker just to move one highlight,
 * which destroyed the row under the pointer — so a double-click to rename never
 * survived its own first click. The rows now carry this key and the highlight
 * moves between them in place.
 *
 * The two kinds are prefixed rather than concatenated raw, so a list that
 * happens to be called "myday" can never collide with the smart view.
 */
export function selectionKey(sel: Selection): string {
	return sel.kind === "list" ? `list:${sel.path}` : `smart:${sel.view}`;
}

/**
 * Which section a new task is added to.
 *
 * Three destinations, and the difference between two of them is a `null`:
 * `addTask` reads `null` as the space above the first heading and `undefined`
 * as the end of the file. So "No group" cannot be defaulted with `??` — that
 * treats an explicit choice as no choice at all, and quietly files the task
 * under the last heading while the box still reads "No group".
 *
 * A heading the pick no longer matches has been deleted or moved since the
 * menu was opened. That falls back rather than failing, because the box is
 * showing the fallback's name by then anyway.
 */
export function addDestination(
	chosen: number | null | undefined,
	sections: ListSection[]
): number | null | undefined {
	if (!sections.length) return undefined;
	if (chosen === null) return null;
	// Nothing picked means no group. Defaulting to the last heading put a task
	// under whichever group happened to be last in the file, which is a
	// destination nobody chose and the one furthest from the top of the list.
	if (chosen === undefined) return null;
	return sections.find((s) => s.line === chosen) ? chosen : null;
}

/** What to do with a file that has just been opened. */
export type OpenVerdict = "swap" | "let-through" | "ignore";

/**
 * Whether a file opening should become a list.
 *
 * The decision lives here rather than inside the workspace event because the
 * interesting part is not the swap, it is the exception: "Open as markdown"
 * opens the file the ordinary way, and without a way past this it would arrive
 * here and be swapped straight back — a menu item that visibly does nothing.
 *
 * `let-through` is the caller's cue to forget the exception, so it holds for
 * exactly one open and the next one is a list again. A stale value can only
 * ever let one open past, never strand a file as text.
 */
export function openVerdict(o: {
	enabled: boolean;
	isListFile: boolean;
	/** The view already in the leaf. Only markdown is ours to replace. */
	viewType?: string;
	/** The one path allowed to open as text, if any. */
	allowedAsMarkdown: string | null;
	path: string;
}): OpenVerdict {
	if (!o.enabled || !o.isListFile) return "ignore";
	if (o.allowedAsMarkdown === o.path) return "let-through";
	return o.viewType === "markdown" ? "swap" : "ignore";
}

/** Which container a List Vibes leaf sits in, relative to the sidebar we want. */
export type LeafPlace = "sidebar" | "main" | "other";

export type SidebarChoice =
	| { action: "reveal"; index: number }
	| { action: "create" };

/**
 * Which leaf is the sidebar picker, given where each of ours lives.
 *
 * `getLeavesOfType` walks the main area before either sidebar, so the first
 * leaf it returns is a tab whenever one is open. Taking that one made the
 * ribbon icon focus whichever list happened to be open, and made the startup
 * guard conclude the picker was already there when it was not — so a vault
 * with tabs open and no picker never got one back.
 *
 * Asking "is one in *this* container" rather than "is there one anywhere" is
 * the same question `listTabs` already asks of the main area, in the other
 * direction.
 */
export function chooseSidebarLeaf(places: LeafPlace[]): SidebarChoice {
	const i = places.indexOf("sidebar");
	return i >= 0 ? { action: "reveal", index: i } : { action: "create" };
}
