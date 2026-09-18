import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseFile } from "./model.mjs";

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
