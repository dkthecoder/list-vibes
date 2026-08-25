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
import { Selection } from "./context";

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
