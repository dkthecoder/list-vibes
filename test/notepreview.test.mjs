import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { notePreview } from "./build/ui/notePreview.js";

/**
 * The one line of a note that shows under a task's title.
 *
 * A note comes out of a markdown file, so it arrives with whatever the user
 * typed: blank lines, bullets, tabs, a heading. The row has space for one line,
 * and what makes the preview useful or useless is which words end up in the
 * first fifty characters — which is exactly what these check.
 */
describe("notePreview", () => {
	test("nothing in, nothing out", () => {
		assert.equal(notePreview(undefined), "");
		assert.equal(notePreview(null), "");
		assert.equal(notePreview(""), "");
		assert.equal(notePreview("   \n\t\n  "), "", "whitespace is not a note");
	});

	test("a one-line note passes straight through", () => {
		assert.equal(notePreview("Ring the dentist back"), "Ring the dentist back");
	});

	test("surrounding whitespace is dropped", () => {
		assert.equal(notePreview("  Ring the dentist back  \n"), "Ring the dentist back");
	});

	test("a wrapped sentence is rejoined rather than truncated at the fold", () => {
		// The failure this guards against: taking only the first line would show
		// "I said I would" and hide the half that says when.
		assert.equal(
			notePreview("I said I would\ncall them back on Tuesday"),
			"I said I would call them back on Tuesday"
		);
	});

	test("blank lines between paragraphs do not become gaps", () => {
		assert.equal(notePreview("First thought.\n\n\nSecond thought."), "First thought. Second thought.");
	});

	test("tabs and runs of spaces collapse to one space", () => {
		assert.equal(notePreview("Milk\t\teggs   bread"), "Milk eggs bread");
	});

	describe("leading markers are stripped, so a list reads as a sentence", () => {
		const cases = [
			["- milk\n- eggs\n- bread", "milk eggs bread", "dashes"],
			["* milk\n* eggs", "milk eggs", "asterisks"],
			["+ milk\n+ eggs", "milk eggs", "pluses"],
			["1. milk\n2. eggs", "milk eggs", "numbers with dots"],
			["1) milk\n2) eggs", "milk eggs", "numbers with brackets"],
			["> quoted thought", "quoted thought", "a blockquote"],
			[">> nested quote", "nested quote", "a nested blockquote"],
			["## A heading\nand its text", "A heading and its text", "a heading"],
			["- [ ] unticked\n- [x] ticked", "unticked ticked", "checkboxes"],
			["  \t- indented bullet", "indented bullet", "an indented bullet"],
		];
		for (const [input, want, what] of cases) {
			test(what, () => assert.equal(notePreview(input), want));
		}
	});

	test("a dash inside the text is left alone", () => {
		// Only a *leading* marker is a marker. Stripping mid-line would eat the
		// user's own punctuation.
		assert.equal(notePreview("call back - ask about the quote"), "call back - ask about the quote");
	});

	test("a hyphenated word survives", () => {
		assert.equal(notePreview("re-check the invoice"), "re-check the invoice");
	});

	test("windows line endings behave like unix ones", () => {
		assert.equal(notePreview("first\r\nsecond"), "first second");
	});

	test("nothing is truncated here — the row does that", () => {
		// Cutting the string would bake a width into the model, and the width
		// depends on the user's font size. CSS owns the ellipsis.
		const long = "word ".repeat(200).trim();
		assert.equal(notePreview(long), long);
	});
});
