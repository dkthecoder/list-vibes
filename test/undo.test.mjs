import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Mutator } from "./build/model/mutate.js";
import { makeApp } from "./obsidian-stub.mjs";
import { parseFile } from "./model.mjs";

/**
 * Undo, for the writes Obsidian cannot undo for us.
 *
 * Obsidian's undo belongs to the editor: it is CodeMirror's history, attached
 * to a Markdown tab. This view is not one. When the file happens to be open the
 * plugin writes through the Editor API and those changes do land in that tab's
 * history — but the ordinary case is ticking a task in the sidebar while the
 * file is open nowhere, and that write goes to disk with nothing tracking it.
 */
const OPTS = {
	dialect: () => "emoji",
	addDoneDate: () => true,
	addCreatedDate: () => false,
	stampTime: () => false,
};

const SAMPLE = [
	"## Work",
	"- [ ] First",
	"- [ ] Second",
	"- [ ] Third",
	"",
].join("\n");

function setup(content = SAMPLE) {
	const path = "lists/Test.md";
	const app = makeApp({ [path]: content }, []);
	return {
		app,
		path,
		mutator: new Mutator(app, OPTS),
		read: () => app.__store.get(path),
		parse: () => parseFile(app.__store.get(path), path),
		task: (i) => parseFile(app.__store.get(path), path).all[i],
	};
}

describe("undo", () => {
	test("there is nothing to undo before anything happens", () => {
		const s = setup();
		assert.equal(s.mutator.canUndo(), false);
	});

	test("a completed task goes back to not being completed", async () => {
		const s = setup();
		const before = s.read();
		await s.mutator.toggle(s.task(0));
		assert.notEqual(s.read(), before);

		assert.equal(s.mutator.canUndo(), true);
		await s.mutator.undo();
		assert.equal(s.read(), before);
	});

	test("undoing twice walks back two edits, newest first", async () => {
		const s = setup();
		const start = s.read();
		await s.mutator.toggle(s.task(0));
		const afterFirst = s.read();
		await s.mutator.toggle(s.task(1));

		await s.mutator.undo();
		assert.equal(s.read(), afterFirst, "the second edit should go first");
		await s.mutator.undo();
		assert.equal(s.read(), start);
	});

	test("the stack empties, and undoing an empty stack is a no-op", async () => {
		const s = setup();
		await s.mutator.toggle(s.task(0));
		await s.mutator.undo();
		assert.equal(s.mutator.canUndo(), false);
		const settled = s.read();
		await s.mutator.undo();
		assert.equal(s.read(), settled);
	});

	test("a move is undone as a whole, not line by line", async () => {
		const s = setup();
		const before = s.read();
		const roots = s.parse().tasks;
		await s.mutator.reorder(roots[0], roots, 2);
		assert.notEqual(s.read(), before);
		await s.mutator.undo();
		assert.equal(s.read(), before);
	});

	test("a section rename is undone", async () => {
		const s = setup();
		const before = s.read();
		await s.mutator.renameSection(s.path, 0, "Office");
		await s.mutator.undo();
		assert.equal(s.read(), before);
	});

	/*
	 * The guard, and the reason this is safe at all. The file may have been
	 * edited by hand, by a sync, or by another plugin between the write and the
	 * undo — in which case restoring what was there before that write would
	 * throw away whatever arrived after it.
	 */
	test("undo refuses when the file changed underneath it", async () => {
		const s = setup();
		await s.mutator.toggle(s.task(0));

		s.app.__store.set(s.path, "- [ ] Something else entirely\n");
		const meddled = s.read();

		const result = await s.mutator.undo();
		assert.equal(result.ok, false);
		assert.equal(s.read(), meddled, "the later edit must survive");
	});

	test("a refused undo does not silently stay on the stack", async () => {
		const s = setup();
		await s.mutator.toggle(s.task(0));
		s.app.__store.set(s.path, "- [ ] Something else entirely\n");
		await s.mutator.undo();
		assert.equal(s.mutator.canUndo(), false);
	});

	test("the stack is capped, so a long session cannot grow without limit", async () => {
		const s = setup();
		for (let i = 0; i < 60; i++) {
			await s.mutator.renameSection(s.path, 0, `Name ${i}`);
		}
		let steps = 0;
		while (s.mutator.canUndo() && steps < 200) {
			await s.mutator.undo();
			steps++;
		}
		assert.ok(steps <= 50, `walked back ${steps} steps`);
		assert.ok(steps > 1, `walked back ${steps} steps`);
	});

	test("deleting a list is undone by putting the file back", async () => {
		const s = setup();
		const before = s.read();
		await s.mutator.deleteList(s.path);
		assert.equal(s.app.__store.has(s.path), false);

		const result = await s.mutator.undo();
		assert.equal(result.ok, true);
		assert.equal(s.read(), before);
	});

	test("an undone delete does not come back a second time", async () => {
		const s = setup();
		await s.mutator.deleteList(s.path);
		await s.mutator.undo();
		assert.equal(s.mutator.canUndo(), false);
	});
});
