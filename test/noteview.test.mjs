import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { rendersVerbatim } from "./build/ui/noteView.js";

/**
 * When a click in the rendered description may be trusted to mean a position
 * in the file.
 *
 * The rendered view and the text on disk are the same characters for plain
 * prose and for a bare URL, and shorter than the source for anything with a
 * label — `[text](href)` draws "text" over a much longer line. An offset taken
 * from the rendering would then point somewhere else entirely, so this is what
 * decides between placing the caret where it was clicked and sending it to the
 * end, which is unhelpful but never wrong.
 */
describe("rendersVerbatim", () => {
	test("plain prose renders as itself", () => {
		assert.equal(rendersVerbatim("just some words"), true);
	});

	test("a bare URL renders as itself", () => {
		assert.equal(
			rendersVerbatim("watch https://www.instagram.com/reel/DbuMBsiCsQQ/ later"),
			true
		);
	});

	test("an empty description is trivially verbatim", () => {
		assert.equal(rendersVerbatim(""), true);
	});

	test("a labelled markdown link does not", () => {
		assert.equal(rendersVerbatim("see [the reel](https://instagram.com/x)"), false);
	});

	test("a wikilink does not", () => {
		assert.equal(rendersVerbatim("see [[Some Note]]"), false);
	});

	test("bold, italic and strike do not", () => {
		assert.equal(rendersVerbatim("**bold**"), false);
		assert.equal(rendersVerbatim("*italic*"), false);
		assert.equal(rendersVerbatim("~~gone~~"), false);
	});

	test("a tag does not, because the marker is dropped", () => {
		assert.equal(rendersVerbatim("about #deutschrap"), false);
	});

	test("inline code does not, because the backticks are dropped", () => {
		assert.equal(rendersVerbatim("run `npm test`"), false);
	});

	test("one transformed piece is enough to disqualify the whole line", () => {
		assert.equal(rendersVerbatim("plain https://x.dev and **bold**"), false);
	});
});
