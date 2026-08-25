import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Mutator } from "./build/mutate.js";
import { makeApp } from "./obsidian-stub.mjs";
import { parseFile } from "./model.mjs";

const OPTS = {
	dialect: () => "emoji",
	addDoneDate: () => true,
	addCreatedDate: () => false,
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
