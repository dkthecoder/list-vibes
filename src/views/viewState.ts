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
