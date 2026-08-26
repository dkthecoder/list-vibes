import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { prettifyName } from "./build/ui/prettify.js";

/**
 * Tidying a list's name for the title above it.
 *
 * Display only, and the reason that matters is not academic: the title is an
 * editable field that renames the file when it is committed. So the risk this
 * function carries is not an ugly title, it is a *silent rename* — which is why
 * the rule for when it does nothing is tested at least as hard as the rule for
 * when it does something.
 */
describe("prettifyName", () => {
	test("separators in a name written without spaces become spaces", () => {
		assert.equal(prettifyName("favourite-animals"), "favourite animals");
		assert.equal(prettifyName("weekly_review"), "weekly review");
		assert.equal(prettifyName("my_todo_list"), "my todo list");
		assert.equal(prettifyName("one-two_three"), "one two three");
	});

	test("a run of separators is one space, not several", () => {
		assert.equal(prettifyName("a--b__c"), "a b c");
	});

	describe("a name that already has spaces is left exactly alone", () => {
		// The whole design. A hyphen the user typed *between spaces they chose*
		// is their punctuation, and rewriting it is editing their prose rather
		// than tidying a filename.
		const untouched = [
			"Movies & TV - new",
			"Q1 - planning",
			"read this - or else",
			"Favourite animals",
			"v1.2 plans",
			"well-known problems and other things",
		];
		for (const name of untouched) {
			test(JSON.stringify(name), () => assert.equal(prettifyName(name), name));
		}
	});

	test("nothing is capitalised", () => {
		// Case is guesswork: "iphone" is not "Iphone". A title that quietly
		// disagrees with the file it names is the whole thing being avoided.
		assert.equal(prettifyName("iphone-notes"), "iphone notes");
		assert.equal(prettifyName("nasa"), "nasa");
	});

	test("a name with no separators comes back untouched", () => {
		assert.equal(prettifyName("Groceries"), "Groceries");
		assert.equal(prettifyName("2026"), "2026");
	});

	test("a name that would tidy away to nothing keeps itself", () => {
		// A blank title is worse than an ugly one, and it would also look like
		// the list had lost its name.
		assert.equal(prettifyName("---"), "---");
		assert.equal(prettifyName("_"), "_");
	});

	test("empty in, empty out", () => {
		assert.equal(prettifyName(""), "");
		assert.equal(prettifyName("   "), "   ");
	});

	test("dots, ampersands and brackets are not separators", () => {
		assert.equal(prettifyName("v1.2"), "v1.2");
		assert.equal(prettifyName("this&that"), "this&that");
		assert.equal(prettifyName("notes(old)"), "notes(old)");
	});

	test("an emoji in the name survives", () => {
		assert.equal(prettifyName("💼work-stuff"), "💼work stuff");
	});
});
