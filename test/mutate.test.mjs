import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Mutator } from "./build/model/mutate.js";
import { makeApp } from "./obsidian-stub.mjs";
import { parseFile } from "./model.mjs";

const OPTS = {
	dialect: () => "emoji",
	addDoneDate: () => true,
	addCreatedDate: () => false,
	// Date-only, which is what every existing line in a vault looks like. The
	// with-a-time path is exercised separately below rather than by changing
	// what these assert.
	stampTime: () => false,
};

function today() {
	const d = new Date();
	const p = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Build a vault with one file, returning helpers to act on it. */
function setup(content, { open = false, opts = OPTS } = {}) {
	const path = "lists/Test.md";
	const app = makeApp({ [path]: content }, open ? [path] : []);
	const mutator = new Mutator(app, opts);
	return {
		app,
		mutator,
		path,
		read: () => app.__store.get(path),
		lines: () => app.__store.get(path).split("\n"),
		parse: () => parseFile(app.__store.get(path), path),
		task: (i) => parseFile(app.__store.get(path), path).all[i],
		root: (i) => parseFile(app.__store.get(path), path).tasks[i],
	};
}

const SAMPLE = [
	"---",
	"icon: 💼",
	"---",
	"",
	"## Work",
	"",
	"- [ ] First task",
	"- [ ] Second task 📅 2026-09-01 ⏫",
	"\t- [x] step one",
	"\t- [ ] step two",
	"\tA note under the parent.",
	"- [x] Third task ✅ 2026-08-01",
	"",
].join("\n");

/* ------------------------------------------------------------------ *
 * Both write paths must behave identically.
 * ------------------------------------------------------------------ */

for (const open of [false, true]) {
	const via = open ? "Editor API (file open)" : "Vault.process (file closed)";

	describe(via, () => {
		test("toggle stamps a completion date and flips the box", async () => {
			const s = setup(SAMPLE, { open });
			await s.mutator.toggle(s.task(0));
			assert.equal(s.lines()[6], `- [x] First task ✅ ${today()}`);
		});

		test("toggle back removes the completion date", async () => {
			const s = setup(SAMPLE, { open });
			await s.mutator.toggle(s.task(0));
			await s.mutator.toggle(s.task(0));
			assert.equal(s.lines()[6], "- [ ] First task");
		});

		test("toggle leaves every other line untouched", async () => {
			const s = setup(SAMPLE, { open });
			const before = s.lines();
			await s.mutator.toggle(s.task(0));
			const after = s.lines();
			assert.equal(before.length, after.length);
			for (let i = 0; i < before.length; i++) {
				if (i === 6) continue;
				assert.equal(after[i], before[i], `line ${i} drifted`);
			}
		});

		test("completion date can be switched off", async () => {
			const s = setup(SAMPLE, {
				open,
				opts: { ...OPTS, addDoneDate: () => false },
			});
			await s.mutator.toggle(s.task(0));
			assert.equal(s.lines()[6], "- [x] First task");
		});

		test("rename keeps metadata in place", async () => {
			const s = setup(SAMPLE, { open });
			await s.mutator.rename(s.task(1), "Renamed task");
			assert.equal(s.lines()[7], "- [ ] Renamed task 📅 2026-09-01 ⏫");
		});

		test("rename refuses empty and newline-injected titles", async () => {
			const s = setup(SAMPLE, { open });
			await s.mutator.rename(s.task(0), "   ");
			assert.equal(s.lines()[6], "- [ ] First task");
			await s.mutator.rename(s.task(0), "one\ntwo");
			assert.equal(s.lines()[6], "- [ ] one two", "newline leaked into the file");
			assert.equal(s.lines().length, SAMPLE.split("\n").length, "line count changed");
		});

		test("setField updates, adds and clears", async () => {
			const s = setup(SAMPLE, { open });
			await s.mutator.setField(s.task(1), "due", "2026-12-25");
			assert.equal(s.lines()[7], "- [ ] Second task 📅 2026-12-25 ⏫");

			await s.mutator.setField(s.task(1), "scheduled", "2026-12-01");
			assert.equal(s.lines()[7], "- [ ] Second task 📅 2026-12-25 ⏫ ⏳ 2026-12-01");

			await s.mutator.setField(s.task(1), "due", null);
			assert.equal(s.lines()[7], "- [ ] Second task ⏫ ⏳ 2026-12-01");
		});

		test("toggleMyDay and toggleImportant round-trip", async () => {
			const s = setup(SAMPLE, { open });
			await s.mutator.toggleMyDay(s.task(0));
			assert.match(s.lines()[6], /☀️/);
			await s.mutator.toggleMyDay(s.task(0));
			assert.equal(s.lines()[6], "- [ ] First task");

			await s.mutator.toggleImportant(s.task(0));
			assert.match(s.lines()[6], /⏫/);
			await s.mutator.toggleImportant(s.task(0));
			assert.equal(s.lines()[6], "- [ ] First task");
		});

		test("toggleImportant clears an existing highest priority", async () => {
			const s = setup("- [ ] Urgent 🔺", { open });
			await s.mutator.toggleImportant(s.task(0));
			assert.equal(s.read(), "- [ ] Urgent");
		});

		test("addTask appends to the end of the file", async () => {
			const s = setup(SAMPLE, { open });
			await s.mutator.addTask(s.path, "New task");
			assert.ok(
				s.read().includes("- [ ] New task"),
				`not appended: ${JSON.stringify(s.read())}`
			);
			assert.equal(s.parse().tasks.length, 4);
			assert.equal(s.parse().tasks[3].title, "New task");
		});

		test("addTask carries metadata and creation date when enabled", async () => {
			const s = setup(SAMPLE, {
				open,
				opts: { ...OPTS, addCreatedDate: () => true },
			});
			await s.mutator.addTask(s.path, "Dated", { due: "2026-10-01", myDay: true });
			const t = s.parse().tasks.at(-1);
			assert.equal(t.meta.due, "2026-10-01");
			assert.equal(t.meta.myDay, true);
			assert.equal(t.meta.created, today());
		});

		test("addTask ignores blank input", async () => {
			const s = setup(SAMPLE, { open });
			const before = s.read();
			await s.mutator.addTask(s.path, "   ");
			assert.equal(s.read(), before);
		});

		test("addStep nests under the parent, after existing steps", async () => {
			const s = setup(SAMPLE, { open });
			await s.mutator.addStep(s.root(1), "step three");
			const parent = s.parse().tasks[1];
			assert.equal(parent.children.length, 3);
			assert.equal(parent.children[2].title, "step three");
			assert.equal(parent.children[2].depth, 1);
			// The parent's note must survive the insertion.
			assert.equal(parent.note, "A note under the parent.");
		});

		test("remove deletes the task, its note and its steps", async () => {
			const s = setup(SAMPLE, { open });
			await s.mutator.remove(s.root(1));
			const after = s.read();
			assert.ok(!after.includes("Second task"), "task left behind");
			assert.ok(!after.includes("step one"), "step left behind");
			assert.ok(!after.includes("A note under"), "note left behind");
			assert.ok(after.includes("First task"), "sibling was removed");
			assert.ok(after.includes("Third task"), "sibling was removed");
			assert.equal(s.parse().tasks.length, 2);
		});

		test("removing a step leaves its siblings and parent intact", async () => {
			const s = setup(SAMPLE, { open });
			await s.mutator.remove(s.root(1).children[0]);
			const parent = s.parse().tasks[1];
			assert.equal(parent.children.length, 1);
			assert.equal(parent.children[0].title, "step two");
			assert.equal(parent.note, "A note under the parent.");
		});
	});
}

/* ------------------------------------------------------------------ *
 * The stale-line guard — the property that stops a bad write.
 * ------------------------------------------------------------------ */

describe("stale parse safety", () => {
	test("an edit is abandoned when the line no longer matches (closed file)", async () => {
		const s = setup(SAMPLE);
		const stale = s.task(0);
		// Someone else rewrites the file behind our back.
		const rewritten = SAMPLE.replace("- [ ] First task", "- [ ] Totally different");
		s.app.__store.set(s.path, rewritten);

		await s.mutator.toggle(stale);
		assert.equal(s.read(), rewritten, "a stale write clobbered the file");
	});

	test("an edit is abandoned when the line no longer matches (open file)", async () => {
		const s = setup(SAMPLE, { open: true });
		const stale = s.task(0);
		const rewritten = SAMPLE.replace("- [ ] First task", "- [ ] Totally different");
		s.app.__store.set(s.path, rewritten);

		await s.mutator.toggle(stale);
		assert.equal(s.read(), rewritten, "a stale write clobbered the file");
	});

	test("an edit past the end of the file is abandoned", async () => {
		const s = setup(SAMPLE);
		const stale = { ...s.task(0), line: 999 };
		const before = s.read();
		await s.mutator.toggle(stale);
		assert.equal(s.read(), before);
	});

	test("a missing file is a no-op rather than a throw", async () => {
		const s = setup(SAMPLE);
		const ghost = { ...s.task(0), filePath: "lists/Gone.md" };
		await s.mutator.toggle(ghost);
		assert.equal(s.read(), SAMPLE);
	});
});

/* ------------------------------------------------------------------ *
 * Reordering
 * ------------------------------------------------------------------ */

describe("move", () => {
	test("moving a task down carries its steps and note with it", async () => {
		const s = setup(SAMPLE);
		const roots = s.parse().tasks;
		await s.mutator.move(roots[1], roots, 1);

		const after = s.parse().tasks;
		assert.deepEqual(
			after.map((t) => t.title),
			["First task", "Third task", "Second task"]
		);
		const moved = after[2];
		assert.equal(moved.children.length, 2, "steps did not travel with the task");
		assert.equal(moved.note, "A note under the parent.", "note did not travel");
	});

	test("moving a task up swaps it with the previous sibling", async () => {
		const s = setup(SAMPLE);
		const roots = s.parse().tasks;
		await s.mutator.move(roots[1], roots, -1);
		assert.deepEqual(
			s.parse().tasks.map((t) => t.title),
			["Second task", "First task", "Third task"]
		);
		assert.equal(s.parse().tasks[0].children.length, 2);
	});

	test("moving past either end does nothing", async () => {
		const s = setup(SAMPLE);
		const roots = s.parse().tasks;
		await s.mutator.move(roots[0], roots, -1);
		assert.equal(s.read(), SAMPLE);
		await s.mutator.move(roots[2], roots, 1);
		assert.equal(s.read(), SAMPLE);
	});

	test("a stale move is abandoned", async () => {
		const s = setup(SAMPLE);
		const roots = s.parse().tasks;
		const rewritten = SAMPLE.replace("- [ ] First task", "- [ ] Changed");
		s.app.__store.set(s.path, rewritten);
		await s.mutator.move(roots[1], roots, -1);
		assert.equal(s.read(), rewritten, "stale move corrupted the file");
	});

	/* --- arbitrary reorder, which is what a drag lands on --- */

	test("dragging a task to the front", async () => {
		const s = setup(SAMPLE);
		const roots = s.parse().tasks;
		await s.mutator.reorder(roots[2], roots, 0);
		assert.deepEqual(
			s.parse().tasks.map((t) => t.title),
			["Third task", "First task", "Second task"]
		);
	});

	test("dragging a task to the end", async () => {
		const s = setup(SAMPLE);
		const roots = s.parse().tasks;
		await s.mutator.reorder(roots[0], roots, 2);
		assert.deepEqual(
			s.parse().tasks.map((t) => t.title),
			["Second task", "Third task", "First task"]
		);
	});

	test("a dragged task lands where the preview showed it, in both directions", async () => {
		// The index is read against the list before the move, so dropping onto
		// index 2 must land at index 2 whichever way the task travelled.
		const down = setup(SAMPLE);
		await down.mutator.reorder(down.parse().tasks[0], down.parse().tasks, 2);
		assert.equal(down.parse().tasks[2].title, "First task");

		const up = setup(SAMPLE);
		await up.mutator.reorder(up.parse().tasks[2], up.parse().tasks, 0);
		assert.equal(up.parse().tasks[0].title, "Third task");
	});

	test("a dragged block keeps its steps and note, and its own order", async () => {
		const s = setup(SAMPLE);
		await s.mutator.reorder(s.parse().tasks[1], s.parse().tasks, 0);
		const moved = s.parse().tasks[0];
		assert.equal(moved.title, "Second task");
		assert.equal(moved.children.length, 2, "steps did not travel");
		assert.deepEqual(
			moved.children.map((c) => c.title),
			["step one", "step two"],
			"steps travelled but were reordered"
		);
		assert.equal(moved.note, "A note under the parent.", "note did not travel");
	});

	test("dropping a task on itself is not a write", async () => {
		const s = setup(SAMPLE);
		const roots = s.parse().tasks;
		await s.mutator.reorder(roots[1], roots, 1);
		assert.equal(s.read(), SAMPLE, "a no-op drop rewrote the file");
	});

	test("an out-of-range index is clamped, never thrown", async () => {
		const s = setup(SAMPLE);
		for (const to of [-5, 99]) {
			const fresh = setup(SAMPLE);
			await fresh.mutator.reorder(fresh.parse().tasks[1], fresh.parse().tasks, to);
			const titles = fresh.parse().tasks.map((t) => t.title);
			assert.equal(titles.length, 3, `lost a task clamping to ${to}`);
			assert.ok(titles.includes("Second task"));
		}
		void s;
	});

	test("a stale reorder is abandoned even when the moved lines still match", async () => {
		// The guard checks every sibling, not just the block being moved: the
		// parse these indices came from may be a frame behind the file.
		const s = setup(SAMPLE);
		const roots = s.parse().tasks;
		const rewritten = SAMPLE.replace("Third task", "Renamed");
		assert.notEqual(rewritten, SAMPLE, "the fixture edit did not apply");
		s.app.__store.set(s.path, rewritten);
		await s.mutator.reorder(roots[0], roots, 1);
		assert.equal(s.read(), rewritten, "stale reorder corrupted the file");
	});

	test("reordering steps within their parent", async () => {
		const s = setup(SAMPLE);
		const steps = s.parse().tasks[1].children;
		assert.equal(steps.length, 2, "fixture changed");
		await s.mutator.reorder(steps[1], steps, 0);
		assert.deepEqual(
			s.parse().tasks[1].children.map((c) => c.title),
			["step two", "step one"]
		);
		// The parent and its siblings must be untouched by a step move.
		assert.deepEqual(
			s.parse().tasks.map((t) => t.title),
			["First task", "Second task", "Third task"]
		);
	});
});

/* ------------------------------------------------------------------ *
 * Dialect handling on write
 * ------------------------------------------------------------------ */

describe("dialects", () => {
	test("the configured dialect is used for new fields", async () => {
		const s = setup("- [ ] Task", {
			opts: { ...OPTS, dialect: () => "dataview" },
		});
		await s.mutator.setField(s.task(0), "due", "2026-09-01");
		assert.equal(s.read(), "- [ ] Task [due:: 2026-09-01]");
	});

	test("an existing field keeps its own dialect regardless of the setting", async () => {
		const s = setup("- [ ] Task [due:: 2026-09-01]");
		await s.mutator.setField(s.task(0), "due", "2026-10-01");
		assert.equal(s.read(), "- [ ] Task [due:: 2026-10-01]");
	});

	test("a dataview completion date is cleared on untoggle", async () => {
		const s = setup("- [x] Task [completion:: 2026-01-01]");
		await s.mutator.toggle(s.task(0));
		assert.equal(s.read(), "- [ ] Task");
	});
});

/* ------------------------------------------------------------------ *
 * Whole-file integrity under a burst of edits
 * ------------------------------------------------------------------ */

test("a sequence of edits never corrupts the file structure", async () => {
	const s = setup(SAMPLE);

	await s.mutator.toggle(s.task(0));
	await s.mutator.setField(s.root(1), "due", "2026-11-11");
	await s.mutator.addStep(s.root(1), "step three");
	await s.mutator.addTask(s.path, "Appended");
	await s.mutator.toggleMyDay(s.root(0));
	await s.mutator.remove(s.parse().tasks[2]);

	const list = s.parse();
	assert.deepEqual(
		list.tasks.map((t) => t.title),
		["First task", "Second task", "Appended"]
	);
	assert.equal(list.tasks[1].children.length, 3);
	assert.equal(list.tasks[1].note, "A note under the parent.");
	assert.equal(list.tasks[1].meta.due, "2026-11-11");
	assert.equal(list.tasks[0].meta.myDay, true);
	assert.equal(list.tasks[0].status, "done");
	// Frontmatter and heading are untouched throughout.
	assert.equal(list.config.icon, "💼");
	assert.ok(s.read().startsWith("---\nicon: 💼\n---"));
	assert.ok(s.read().includes("## Work"));
});

/* ------------------------------------------------------------------ *
 * Notes — the indented prose beneath a task
 * ------------------------------------------------------------------ */

describe("notes", () => {
	for (const open of [false, true]) {
		const via = open ? "editor" : "process";

		test(`sets a note on a task that had none (${via})`, async () => {
			const s = setup(SAMPLE, { open });
			await s.mutator.setNote(s.task(0), "Remember the pricing table.");
			const t = s.parse().tasks[0];
			assert.equal(t.note, "Remember the pricing table.");
			// Inserted directly beneath its own task, not at the end.
			assert.equal(s.lines()[7], "\tRemember the pricing table.");
			assert.equal(s.parse().tasks.length, 3, "list structure changed");
		});

		test(`replaces an existing note in place (${via})`, async () => {
			const s = setup(SAMPLE, { open });
			await s.mutator.setNote(s.root(1), "Replaced text.");
			const t = s.parse().tasks[1];
			assert.equal(t.note, "Replaced text.");
			assert.equal(t.children.length, 2, "steps were disturbed");
			assert.equal(s.parse().tasks.length, 3);
			assert.ok(!s.read().includes("A note under the parent"), "old note survived");
		});

		test(`clearing a note removes its lines (${via})`, async () => {
			const s = setup(SAMPLE, { open });
			const before = s.lines().length;
			await s.mutator.setNote(s.root(1), "");
			const t = s.parse().tasks[1];
			assert.equal(t.note, undefined);
			assert.equal(t.children.length, 2, "steps were removed too");
			assert.equal(s.lines().length, before - 1);
		});

		test(`a multi-line note round-trips (${via})`, async () => {
			const s = setup(SAMPLE, { open });
			await s.mutator.setNote(s.task(0), "First line.\nSecond line.");
			assert.equal(s.parse().tasks[0].note, "First line.\nSecond line.");
			assert.equal(s.parse().tasks.length, 3);
		});

		test(`setting the same note is a no-op (${via})`, async () => {
			const s = setup(SAMPLE, { open });
			const before = s.read();
			await s.mutator.setNote(s.root(1), "A note under the parent.");
			assert.equal(s.read(), before);
		});
	}

	test("a stale note write is abandoned", async () => {
		const s = setup(SAMPLE);
		const stale = s.task(0);
		const rewritten = SAMPLE.replace("- [ ] First task", "- [ ] Changed");
		s.app.__store.set(s.path, rewritten);
		await s.mutator.setNote(stale, "Should not land");
		assert.equal(s.read(), rewritten);
	});

	test("addTask can carry a description", async () => {
		const s = setup(SAMPLE);
		await s.mutator.addTask(s.path, "With a note", {}, { note: "The description." });
		const added = s.parse().tasks.at(-1);
		assert.equal(added.title, "With a note");
		assert.equal(added.note, "The description.");
	});

	test("addTask with a blank description adds no extra line", async () => {
		const s = setup(SAMPLE);
		const before = s.lines().length;
		await s.mutator.addTask(s.path, "No note", {}, { note: "   " });
		assert.equal(s.lines().length, before + 1);
		assert.equal(s.parse().tasks.at(-1).note, undefined);
	});

	test("indentation style follows the parent task", async () => {
		// A space-indented file should not suddenly gain tabs.
		const spaced = ["- [ ] Parent", "    - [ ] Step"].join("\n");
		const s = setup(spaced);
		await s.mutator.addStep(s.root(0), "Another step");
		assert.ok(
			s.lines()[2].startsWith("    "),
			`expected spaces, got ${JSON.stringify(s.lines()[2])}`
		);
	});
});

/* ------------------------------------------------------------------ *
 * List-level operations: config in frontmatter, and renaming the file
 * ------------------------------------------------------------------ */

describe("list config", () => {
	for (const open of [false, true]) {
		const via = open ? "editor" : "process";

		test(`sets a colour on a list with existing frontmatter (${via})`, async () => {
			const s = setup(SAMPLE, { open });
			await s.mutator.setListConfig(s.path, "color", "red");
			assert.equal(s.parse().config.color, "red");
			assert.equal(s.parse().config.icon, "💼", "existing key lost");
			// Tasks are untouched.
			assert.equal(s.parse().tasks.length, 3);
			assert.equal(s.parse().tasks[1].children.length, 2);
		});

		test(`adds frontmatter to a list that has none (${via})`, async () => {
			const s = setup("- [ ] Only a task", { open });
			await s.mutator.setListConfig(s.path, "color", "teal");
			assert.equal(s.parse().config.color, "teal");
			assert.equal(s.parse().tasks.length, 1);
			assert.equal(s.parse().tasks[0].title, "Only a task");
		});

		test(`clearing a colour removes just that key (${via})`, async () => {
			const s = setup(SAMPLE, { open });
			await s.mutator.setListConfig(s.path, "color", "red");
			await s.mutator.setListConfig(s.path, "color", null);
			assert.equal(s.parse().config.color, undefined);
			assert.equal(s.parse().config.icon, "💼");
		});

		test(`setting the same value twice writes once (${via})`, async () => {
			const s = setup(SAMPLE, { open });
			await s.mutator.setListConfig(s.path, "color", "red");
			const after = s.read();
			await s.mutator.setListConfig(s.path, "color", "red");
			assert.equal(s.read(), after, "second write changed the file");
		});

		test(`repeated colour changes do not stack duplicate keys (${via})`, async () => {
			const s = setup(SAMPLE, { open });
			for (const c of ["red", "blue", "green"]) {
				await s.mutator.setListConfig(s.path, "color", c);
			}
			assert.equal((s.read().match(/^color:/gm) || []).length, 1);
			assert.equal(s.parse().config.color, "green");
		});
	}

	test("a Kanban board keeps its own frontmatter", async () => {
		const kanban = [
			"---",
			"",
			"kanban-plugin: board",
			"",
			"---",
			"",
			"## Monday",
			"",
			"- [ ] Gym",
		].join("\n");
		const s = setup(kanban);
		await s.mutator.setListConfig(s.path, "color", "purple");
		assert.ok(s.read().includes("kanban-plugin: board"), "kanban key lost");
		assert.equal(s.parse().config.color, "purple");
		assert.equal(s.parse().tasks.length, 1);
	});

	test("config on a missing file is a no-op rather than a throw", async () => {
		const s = setup(SAMPLE);
		await s.mutator.setListConfig("lists/Gone.md", "color", "red");
		assert.equal(s.read(), SAMPLE);
	});
});

describe("rename list", () => {
	test("renames the file and keeps the content", async () => {
		const s = setup(SAMPLE);
		const next = await s.mutator.renameList(s.path, "Groceries");
		assert.equal(next, "lists/Groceries.md");
		assert.equal(s.app.__store.get("lists/Groceries.md"), SAMPLE);
		assert.equal(s.app.__store.has("lists/Test.md"), false, "old file left behind");
	});

	test("strips characters a filename cannot contain", async () => {
		const s = setup(SAMPLE);
		const next = await s.mutator.renameList(s.path, 'We:ird/Na*me?"');
		assert.equal(next, "lists/WeirdName.md");
	});

	test("collapses the whitespace left behind by stripping", async () => {
		const s = setup(SAMPLE);
		const next = await s.mutator.renameList(s.path, "  Weekly   /  Review  ");
		assert.equal(next, "lists/Weekly Review.md");
	});

	test("keeps an emoji prefix, since that is the list icon", async () => {
		const s = setup(SAMPLE);
		const next = await s.mutator.renameList(s.path, "📺 Shows");
		assert.equal(next, "lists/📺 Shows.md");
	});

	test("refuses a blank name", async () => {
		const s = setup(SAMPLE);
		assert.equal(await s.mutator.renameList(s.path, '   /// '), null);
		assert.equal(s.app.__store.has("lists/Test.md"), true);
	});

	test("renaming to the same name does nothing", async () => {
		const s = setup(SAMPLE);
		assert.equal(await s.mutator.renameList(s.path, "Test"), null);
		assert.equal(s.app.__store.has("lists/Test.md"), true);
	});

	test("refuses to clobber an existing list", async () => {
		const app = makeApp({ "lists/A.md": "- [ ] a", "lists/B.md": "- [ ] b" });
		const m = new Mutator(app, OPTS);
		assert.equal(await m.renameList("lists/A.md", "B"), null);
		assert.equal(app.__store.get("lists/B.md"), "- [ ] b", "B was overwritten");
		assert.equal(app.__store.get("lists/A.md"), "- [ ] a", "A was lost");
	});

	test("renaming a missing file is a no-op", async () => {
		const s = setup(SAMPLE);
		assert.equal(await s.mutator.renameList("lists/Gone.md", "X"), null);
	});
});

/* ------------------------------------------------------------------ *
 * Repeating tasks
 * ------------------------------------------------------------------ */

describe("repeat", () => {
	const REPEATING = [
		"- [ ] Water the plants 🔁 every 3 days 📅 2026-03-01",
		"- [ ] Something else",
		"",
	].join("\n");

	test("completing a repeating task leaves the next one behind", async () => {
		const s = setup(REPEATING);
		await s.mutator.toggle(s.root(0));

		const tasks = s.parse().tasks;
		assert.equal(tasks.length, 3, "expected the next instance plus both originals");

		// The new one comes first: what is still to do sits above the record of
		// what is done.
		assert.equal(tasks[0].title, "Water the plants");
		assert.equal(tasks[0].status, "todo");
		assert.equal(tasks[0].meta.due, "2026-03-04", "the due date did not advance");
		assert.equal(tasks[0].meta.repeat, "every 3 days", "the rule did not travel");
		assert.equal(tasks[0].meta.done, undefined, "the new one is not already done");

		assert.equal(tasks[1].status, "done", "the original was not completed");
	});

	test("un-completing does not spawn anything", async () => {
		const s = setup(REPEATING);
		await s.mutator.toggle(s.root(0));
		const after = s.parse().tasks.length;
		// Tick the completed one back off.
		await s.mutator.toggle(s.parse().tasks[1]);
		assert.equal(s.parse().tasks.length, after, "un-completing added a task");
	});

	test("a task with no repeat rule spawns nothing", async () => {
		const s = setup(REPEATING);
		await s.mutator.toggle(s.root(1));
		assert.equal(s.parse().tasks.length, 2, "a plain task spawned a repeat");
	});

	test("an unrecognised rule spawns nothing rather than guessing", async () => {
		const s = setup("- [ ] Odd 🔁 every blue moon 📅 2026-03-01\n");
		await s.mutator.toggle(s.root(0));
		assert.equal(s.parse().tasks.length, 1);
		assert.equal(s.parse().tasks[0].status, "done");
	});

	test("the repeated task keeps its other metadata", async () => {
		const s = setup("- [ ] Chores 🔁 every week 📅 2026-03-01 ⏫ ☀️\n");
		await s.mutator.toggle(s.root(0));
		const next = s.parse().tasks[0];
		assert.equal(next.meta.priority, "high", "priority did not travel");
		assert.equal(next.meta.myDay, true, "My Day did not travel");
		assert.equal(next.meta.due, "2026-03-08");
	});

	test("indentation and bullet style are preserved", async () => {
		// A repeating step lives under its parent and has to stay there.
		const s = setup(
			["- [ ] Parent", "\t- [ ] Step 🔁 every day 📅 2026-03-01", ""].join("\n")
		);
		const step = s.parse().tasks[0].children[0];
		await s.mutator.toggle(step);
		const lines = s.lines();
		assert.ok(lines[1].startsWith("\t- [ ]"), `lost its indent: ${JSON.stringify(lines[1])}`);
		assert.ok(lines[2].startsWith("\t- [x]"), `original moved: ${JSON.stringify(lines[2])}`);
	});
});

/* ------------------------------------------------------------------ *
 * Promotion to a note
 * ------------------------------------------------------------------ */

describe("promote", () => {
	const LIST = [
		"- [ ] Plan the trip 📅 2026-09-01 ⏫",
		"\tSome notes about the trip.",
		"- [ ] Other",
		"",
	].join("\n");

	test("the line becomes a link and the note is created", async () => {
		const s = setup(LIST);
		const path = await s.mutator.promote(s.root(0), "tasks");

		assert.equal(path, "tasks/Plan the trip.md");
		assert.ok(s.app.__store.has(path), "the note was not created");

		const line = s.lines()[0];
		assert.ok(line.includes("[[Plan the trip|Plan the trip]]"), line);
	});

	test("the metadata stays on the line, not in the note", async () => {
		// The line is what the list reads, what Obsidian Tasks reads, and what
		// survives this plugin being uninstalled.
		const s = setup(LIST);
		await s.mutator.promote(s.root(0), "tasks");
		const t = s.parse().tasks[0];
		assert.equal(t.meta.due, "2026-09-01", "the due date left the line");
		assert.equal(t.meta.priority, "high", "the priority left the line");
		assert.equal(t.status, "todo");
	});

	test("the task's note becomes the body", async () => {
		const s = setup(LIST);
		const path = await s.mutator.promote(s.root(0), "tasks");
		assert.ok(
			s.app.__store.get(path).includes("Some notes about the trip."),
			"the note body was lost"
		);
	});

	test("a second task with the same name does not overwrite the first", async () => {
		const s = setup(["- [ ] Same", "- [ ] Same", ""].join("\n"));
		const a = await s.mutator.promote(s.parse().tasks[0], "tasks");
		const b = await s.mutator.promote(s.parse().tasks[1], "tasks");
		assert.notEqual(a, b, "the second promotion reused the first note");
		assert.ok(s.app.__store.has(a));
		assert.ok(s.app.__store.has(b));
	});

	test("promoting an already-promoted task is refused", async () => {
		const s = setup("- [ ] [[Somewhere|A task]]\n");
		assert.equal(await s.mutator.promote(s.root(0), "tasks"), null);
	});

	test("a name that cannot be a filename is refused, not mangled into nothing", async () => {
		const s = setup('- [ ] ///:*?\n');
		const before = s.read();
		assert.equal(await s.mutator.promote(s.root(0), "tasks"), null);
		assert.equal(s.read(), before, "the line was changed anyway");
	});

	test("illegal characters are stripped rather than failing", async () => {
		const s = setup('- [ ] Plan: the "big" trip?\n');
		const path = await s.mutator.promote(s.root(0), "tasks");
		assert.equal(path, "tasks/Plan the big trip.md");
		// The displayed title is untouched — only the filename is cleaned.
		assert.ok(s.lines()[0].includes('|Plan: the "big" trip?]]'), s.lines()[0]);
	});
});

/**
 * A completion stamp that carries a time.
 *
 * `✅ 2026-08-26` tells you a task was finished today, which by tomorrow tells
 * you nothing. The time is what makes a day's completions readable as a
 * sequence, and it is written with a `T` because the emoji dialect is parsed by
 * splitting on whitespace — a stamp with a space in it reads as a date followed
 * by a stray word, here and in every other tool that reads these files.
 */
describe("stamping the time", () => {
	const withTime = { ...OPTS, stampTime: () => true };

	test("a completed task gets a date and a time", async () => {
		const s = setup("- [ ] Cake\n", { opts: withTime });
		await s.mutator.toggle(s.task(0));
		assert.match(s.read(), /✅ \d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, s.read());
	});

	test("and the stamp stays one whitespace-free token", async () => {
		// The property the `T` exists for. A space here would be parsed as a
		// date followed by a word, and the word would land in the title.
		const s = setup("- [ ] Cake\n", { opts: withTime });
		await s.mutator.toggle(s.task(0));
		assert.equal(s.root(0).title, "Cake", s.read());
	});

	test("turning it off writes a bare date, as before", async () => {
		const s = setup("- [ ] Cake\n");
		await s.mutator.toggle(s.task(0));
		assert.doesNotMatch(s.read(), /T\d{2}:\d{2}/, s.read());
	});

	test("and an existing bare date is still read", () => {
		// Nothing in a vault gets rewritten by this. Every line already there
		// keeps its shape and keeps parsing.
		const t = parseFile("- [x] Cake ✅ 2026-08-20\n", "lists/Test.md").tasks[0];
		assert.equal(t.meta.done, "2026-08-20");
		assert.equal(t.title, "Cake");
	});

	test("and a hand-typed space between date and time is accepted", () => {
		// Written with a `T`, but somebody editing markdown will type a space,
		// and being strict about that would silently drop their edit.
		const t = parseFile("- [x] Cake ✅ 2026-08-20 14:32\n", "lists/Test.md").tasks[0];
		assert.equal(t.meta.done, "2026-08-20T14:32");
	});
});
