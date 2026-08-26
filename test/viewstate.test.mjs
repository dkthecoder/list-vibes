import { test, describe } from "node:test";
import { sameSelection } from "./build/views/context.js";
import assert from "node:assert/strict";
import {
	encodeSelection,
	decodeSelection,
	selectionTitle,
	widerScope,
	chooseTab,
	selectionKey,
	encodeTaskRef,
	decodeTaskRef,
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

/* ------------------------------------------------------------------
   Which tab a picked list opens in

   Clicking through five lists should leave one tab, not five — and
   must never take over a tab holding something else.
   ------------------------------------------------------------------ */

const LIST = (path) => ({ kind: "list", path });
const SMART = (view) => ({ kind: "smart", view });
const tab = (selection, pinned = false) => ({ selection, pinned });

test("chooseTab", async (t) => {
	await t.test("with nothing open, a new tab", () => {
		assert.deepEqual(chooseTab([], LIST("lists/A.md")), { action: "new" });
	});

	await t.test("a tab already showing it is focused, not duplicated", () => {
		const tabs = [tab(LIST("lists/A.md")), tab(LIST("lists/B.md"))];
		assert.deepEqual(chooseTab(tabs, LIST("lists/B.md")), {
			action: "focus",
			index: 1,
		});
	});

	await t.test("otherwise the first free tab is retargeted", () => {
		const tabs = [tab(LIST("lists/A.md")), tab(LIST("lists/B.md"))];
		assert.deepEqual(chooseTab(tabs, LIST("lists/C.md")), {
			action: "retarget",
			index: 0,
		});
	});

	await t.test("clicking through many lists never grows the tab count", () => {
		// The whole point of the rule.
		let tabs = [];
		for (const name of ["A", "B", "C", "D", "E"]) {
			const sel = LIST(`lists/${name}.md`);
			const choice = chooseTab(tabs, sel);
			if (choice.action === "new") tabs.push(tab(sel));
			else if (choice.action === "retarget") tabs[choice.index] = tab(sel);
		}
		assert.equal(tabs.length, 1, "clicking five lists left more than one tab");
		assert.deepEqual(tabs[0].selection, LIST("lists/E.md"));
	});

	await t.test("a pinned tab is never retargeted", () => {
		const tabs = [tab(LIST("lists/A.md"), true)];
		assert.deepEqual(chooseTab(tabs, LIST("lists/B.md")), { action: "new" });
	});

	await t.test("but a pinned tab showing it is still focused", () => {
		// Focusing does not disturb a pinned tab, so there is no reason to
		// open a second copy of something already on screen.
		const tabs = [tab(LIST("lists/A.md"), true)];
		assert.deepEqual(chooseTab(tabs, LIST("lists/A.md")), {
			action: "focus",
			index: 0,
		});
	});

	await t.test("the first unpinned tab is chosen, skipping pinned ones", () => {
		const tabs = [
			tab(LIST("lists/A.md"), true),
			tab(LIST("lists/B.md"), true),
			tab(LIST("lists/C.md"), false),
		];
		assert.deepEqual(chooseTab(tabs, LIST("lists/D.md")), {
			action: "retarget",
			index: 2,
		});
	});

	await t.test("forcing a new tab overrides every reuse rule", () => {
		// ⌘-click, middle-click and the named command all mean "another one",
		// even when the list is already on screen.
		const tabs = [tab(LIST("lists/A.md"))];
		assert.deepEqual(chooseTab(tabs, LIST("lists/A.md"), true), { action: "new" });
		assert.deepEqual(chooseTab(tabs, LIST("lists/B.md"), true), { action: "new" });
	});

	await t.test("a tab whose state could not be read is retargetable, not matched", () => {
		// decodeSelection returns null for a state blob from an older version or
		// a hand-edited workspace file. It must never compare equal to anything.
		const tabs = [tab(null)];
		assert.deepEqual(chooseTab(tabs, LIST("lists/A.md")), {
			action: "retarget",
			index: 0,
		});
	});

	await t.test("smart views take part in the same rule", () => {
		const tabs = [tab(SMART("myday")), tab(LIST("lists/A.md"))];
		assert.deepEqual(chooseTab(tabs, SMART("myday")), { action: "focus", index: 0 });
		assert.deepEqual(chooseTab(tabs, SMART("important")), {
			action: "retarget",
			index: 0,
		});
	});

	await t.test("a list and a smart view are never confused for each other", () => {
		const tabs = [tab(SMART("myday"))];
		assert.notDeepEqual(chooseTab(tabs, LIST("lists/myday.md")), {
			action: "focus",
			index: 0,
		});
	});
});

test("selectionKey", async (t) => {
	await t.test("is stable for the same selection", () => {
		assert.equal(selectionKey(LIST("lists/A.md")), selectionKey(LIST("lists/A.md")));
		assert.equal(selectionKey(SMART("myday")), selectionKey(SMART("myday")));
	});

	await t.test("differs between different selections", () => {
		assert.notEqual(selectionKey(LIST("lists/A.md")), selectionKey(LIST("lists/B.md")));
		assert.notEqual(selectionKey(SMART("myday")), selectionKey(SMART("planned")));
	});

	await t.test("a list never collides with a smart view of the same name", () => {
		// Why the kinds are prefixed rather than concatenated raw: a list called
		// "myday" would otherwise share a key with the My Day view, and the
		// picker would highlight both.
		assert.notEqual(selectionKey(LIST("myday")), selectionKey(SMART("myday")));
		assert.notEqual(selectionKey(LIST("lists/myday.md")), selectionKey(SMART("myday")));
	});

	await t.test("agrees with sameSelection on every pair", () => {
		const all = [
			LIST("lists/A.md"),
			LIST("lists/B.md"),
			LIST("myday"),
			SMART("myday"),
			SMART("planned"),
		];
		for (const a of all) {
			for (const b of all) {
				assert.equal(
					selectionKey(a) === selectionKey(b),
					sameSelection(a, b),
					`${JSON.stringify(a)} vs ${JSON.stringify(b)}`
				);
			}
		}
	});
});

/**
 * The open task, as part of the view's state.
 *
 * This is what makes back close the detail panel: Obsidian records the previous
 * state in the leaf's history, and both back buttons on mobile — the one in the
 * navigation bar and Android's own — walk that history. It is also written into
 * `workspace.json` and read back on restart, so it has to survive a blob written
 * by a version that had never heard of it.
 */
describe("encodeTaskRef / decodeTaskRef", () => {
	test("nothing selected writes no keys at all", () => {
		// Absent rather than null: an absent key reads the same in every version
		// that ever existed, including the ones before this feature.
		assert.deepEqual(encodeTaskRef(null), {});
	});

	test("a selected task round-trips", () => {
		const ref = { filePath: "lists/Work.md", line: 12 };
		assert.deepEqual(decodeTaskRef(encodeTaskRef(ref)), ref);
	});

	test("line zero is a real line", () => {
		// The first line of a file. A truthiness check here would silently drop
		// the selection for exactly one task in every list.
		const ref = { filePath: "lists/Work.md", line: 0 };
		assert.deepEqual(decodeTaskRef(encodeTaskRef(ref)), ref);
	});

	test("it rides alongside the selection without disturbing it", () => {
		const blob = { ...encodeSelection({ kind: "list", path: "lists/Work.md" }), ...encodeTaskRef({ filePath: "lists/Work.md", line: 3 }) };
		assert.deepEqual(decodeSelection(blob), { kind: "list", path: "lists/Work.md" });
		assert.deepEqual(decodeTaskRef(blob), { filePath: "lists/Work.md", line: 3 });
	});

	describe("a blob that says nothing usable means nothing is open", () => {
		const cases = [
			[undefined, "undefined"],
			[null, "null"],
			["lists/Work.md", "a bare string"],
			[{}, "an empty object"],
			[{ kind: "list", path: "lists/Work.md" }, "a state from before this existed"],
			[{ taskPath: "lists/Work.md" }, "a path with no line"],
			[{ taskLine: 4 }, "a line with no path"],
			[{ taskPath: "", taskLine: 4 }, "an empty path"],
			[{ taskPath: "lists/Work.md", taskLine: -1 }, "a negative line"],
			[{ taskPath: "lists/Work.md", taskLine: 1.5 }, "a fractional line"],
			[{ taskPath: "lists/Work.md", taskLine: "4" }, "a line as a string"],
			[{ taskPath: 4, taskLine: 4 }, "a path that is not a string"],
		];
		for (const [blob, what] of cases) {
			test(what, () => assert.equal(decodeTaskRef(blob), null));
		}
	});
});
