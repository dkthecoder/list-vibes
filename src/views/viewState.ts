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

const SMART_VIEWS: SmartView[] = ["myday", "important", "planned", "all"];

export interface SerialisedSelection {
	kind?: string;
	path?: string;
	view?: string;
	/** Obsidian persists this as an open record. */
	[key: string]: unknown;
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
	const base = sel.path.split("/").pop() ?? sel.path;
	return base.replace(/\.md$/i, "");
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
	forceNew = false
): TabChoice {
	if (forceNew) return { action: "new" };

	const showing = tabs.findIndex(
		(t) => t.selection && sameSelection(t.selection, sel)
	);
	if (showing >= 0) return { action: "focus", index: showing };

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
