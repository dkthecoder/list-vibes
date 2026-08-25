import { test } from "node:test";
import assert from "node:assert/strict";
import {
	encodeSelection,
	decodeSelection,
	selectionTitle,
	widerScope,
} from "./build/views/viewState.js";

/* A tab only remembers its own list if this round-trips exactly. */

test("a list selection round-trips", () => {
	const sel = { kind: "list", path: "lists/💼Work To-Dos.md" };
	assert.deepEqual(decodeSelection(encodeSelection(sel)), sel);
});

test("every smart view round-trips", () => {
	for (const view of ["myday", "important", "planned", "all"]) {
		const sel = { kind: "smart", view };
		assert.deepEqual(decodeSelection(encodeSelection(sel)), sel);
	}
});

test("paths with unicode and spaces survive", () => {
	const sel = { kind: "list", path: "lists/📺Movies & TV - new.md" };
	assert.deepEqual(decodeSelection(encodeSelection(sel)), sel);
});

test("junk state decodes to null rather than a broken view", () => {
	for (const bad of [
		undefined,
		null,
		"",
		"lists/x.md",
		42,
		{},
		{ kind: "list" },              // no path
		{ kind: "list", path: "" },    // empty path
		{ kind: "list", path: 7 },     // wrong type
		{ kind: "smart" },             // no view
		{ kind: "smart", view: "nope" },
		{ kind: "elsewhere", path: "lists/x.md" },
	]) {
		assert.equal(decodeSelection(bad), null, `should reject ${JSON.stringify(bad)}`);
	}
});

test("extra keys in a stored blob are ignored, not fatal", () => {
	const decoded = decodeSelection({
		kind: "list",
		path: "lists/A.md",
		leftoverFromAnOlderVersion: true,
	});
	assert.deepEqual(decoded, { kind: "list", path: "lists/A.md" });
});

test("tab titles name the list, not the plugin", () => {
	assert.equal(
		selectionTitle({ kind: "list", path: "lists/📺Shows.md" }, "Shows"),
		"Shows"
	);
	// Falls back to the filename when the list is not loaded yet.
	assert.equal(selectionTitle({ kind: "list", path: "lists/Work To-Dos.md" }), "Work To-Dos");
	assert.equal(selectionTitle({ kind: "list", path: "Deep/Nested/A.md" }), "A");
});

test("smart views get readable tab titles", () => {
	assert.equal(selectionTitle({ kind: "smart", view: "myday" }), "My Day");
	assert.equal(selectionTitle({ kind: "smart", view: "important" }), "Important");
	assert.equal(selectionTitle({ kind: "smart", view: "planned" }), "Planned");
	assert.equal(selectionTitle({ kind: "smart", view: "all" }), "Tasks");
});

test("encoded state is a plain serialisable object", () => {
	const encoded = encodeSelection({ kind: "list", path: "lists/A.md" });
	// Obsidian writes this into workspace.json, so it must survive JSON.
	assert.deepEqual(JSON.parse(JSON.stringify(encoded)), encoded);
	assert.deepEqual(decodeSelection(JSON.parse(JSON.stringify(encoded))), {
		kind: "list",
		path: "lists/A.md",
	});
});

/* ------------------------------------------------------------------
   Repaint scope

   These guard the rule that stops the view flashing: repaints are
   coalesced into one frame, and coalescing must widen, never narrow.
   ------------------------------------------------------------------ */

test("widerScope", async (t) => {
	const ORDER = ["detail", "tasks", "all"];

	await t.test("a scope merged with itself is unchanged", () => {
		for (const s of ORDER) assert.equal(widerScope(s, s), s);
	});

	await t.test("wins in both argument orders", () => {
		for (let i = 0; i < ORDER.length; i++) {
			for (let j = 0; j < ORDER.length; j++) {
				const wider = ORDER[Math.max(i, j)];
				assert.equal(widerScope(ORDER[i], ORDER[j]), wider);
				assert.equal(widerScope(ORDER[j], ORDER[i]), wider);
			}
		}
	});

	await t.test("a queued repaint is never narrowed", () => {
		// The case that matters: a file change arriving while a detail row is
		// expanding must not be reduced to a detail-only repaint, or the task
		// list behind the panel keeps showing the old text.
		assert.equal(widerScope("detail", "tasks"), "tasks");
		assert.equal(widerScope("detail", "all"), "all");
		assert.equal(widerScope("tasks", "all"), "all");
	});

	await t.test("folding a burst in any order gives the widest", () => {
		const fold = (scopes) => scopes.reduce(widerScope);
		assert.equal(fold(["detail", "detail", "tasks"]), "tasks");
		assert.equal(fold(["tasks", "detail", "detail"]), "tasks");
		assert.equal(fold(["detail", "all", "detail"]), "all");
		assert.equal(fold(["detail", "detail", "detail"]), "detail");
	});
});
