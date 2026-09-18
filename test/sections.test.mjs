import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseFile } from "./model.mjs";
import { Mutator } from "./build/model/mutate.js";
import { makeApp } from "./obsidian-stub.mjs";

/**
 * A section is a `##` heading and everything under it until the next one.
 *
 * The parser already records which section a task sits in, as a string. That is
 * enough to group rows and not enough to edit one: two sections can share a
 * name, and renaming or moving one means knowing which line its heading is on.
 */
const SAMPLE = [
	"---", //                 0
	"icon: 💼", //            1
	"---", //                 2
	"", //                    3
	"## Work", //             4
	"", //                    5
	"- [ ] First task", //    6
	"- [ ] Second task", //   7
	"", //                    8
	"## Home", //             9
	"", //                   10
	"- [ ] Third task", //   11
	"", //                   12
].join("\n");

describe("section parsing", () => {
	test("a list exposes its headings with the line each one is on", () => {
		const list = parseFile(SAMPLE, "lists/Test.md");
		assert.deepEqual(list.sections, [
			{ name: "Work", line: 4 },
			{ name: "Home", line: 9 },
		]);
	});

	test("a list with no headings has no sections", () => {
		const list = parseFile("- [ ] Loose task\n", "lists/Test.md");
		assert.deepEqual(list.sections, []);
	});

	test("two sections may share a name and stay distinguishable", () => {
		const content = ["## Same", "- [ ] a", "## Same", "- [ ] b"].join("\n");
		const list = parseFile(content, "lists/Test.md");
		assert.deepEqual(list.sections, [
			{ name: "Same", line: 0 },
			{ name: "Same", line: 2 },
		]);
	});
});

/* ------------------------------------------------------------------ *
 * Writing sections. Every operation is a line splice, never a rebuild.
 * ------------------------------------------------------------------ */

const WRITE_OPTS = {
	dialect: () => "emoji",
	addDoneDate: () => true,
	addCreatedDate: () => false,
	stampTime: () => false,
};

function setup(content, { open = false } = {}) {
	const path = "lists/Test.md";
	const app = makeApp({ [path]: content }, open ? [path] : []);
	return {
		mutator: new Mutator(app, WRITE_OPTS),
		path,
		lines: () => app.__store.get(path).split("\n"),
		parse: () => parseFile(app.__store.get(path), path),
	};
}

describe("renameSection", () => {
	test("rewrites the heading and leaves its tasks alone", async () => {
		const s = setup(SAMPLE);
		const before = s.lines();
		await s.mutator.renameSection(s.path, 4, "Office");
		assert.equal(s.lines()[4], "## Office");
		assert.deepEqual(s.lines().slice(5), before.slice(5));
	});

	test("renames only the heading on the given line", async () => {
		const content = ["## Same", "- [ ] a", "## Same", "- [ ] b"].join("\n");
		const s = setup(content);
		await s.mutator.renameSection(s.path, 2, "Other");
		assert.deepEqual(s.lines(), ["## Same", "- [ ] a", "## Other", "- [ ] b"]);
	});

	test("keeps the heading level it found", async () => {
		const s = setup("### Deep\n- [ ] a\n");
		await s.mutator.renameSection(s.path, 0, "Deeper");
		assert.equal(s.lines()[0], "### Deeper");
	});

	test("a rename of a line that is not a heading is abandoned", async () => {
		const s = setup(SAMPLE);
		const before = s.lines();
		await s.mutator.renameSection(s.path, 6, "Nope");
		assert.deepEqual(s.lines(), before);
	});
});

describe("createSection", () => {
	test("adds a heading at the end of the file", async () => {
		const s = setup(SAMPLE);
		await s.mutator.createSection(s.path, "Errands");
		const names = s.parse().sections.map((x) => x.name);
		assert.deepEqual(names, ["Work", "Home", "Errands"]);
	});

	test("the new section is empty and does not disturb the tasks", async () => {
		const s = setup(SAMPLE);
		const before = s.parse().all.map((t) => t.raw);
		await s.mutator.createSection(s.path, "Errands");
		assert.deepEqual(
			s.parse().all.map((t) => t.raw),
			before
		);
	});
});
