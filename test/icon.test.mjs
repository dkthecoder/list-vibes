import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { firstGlyph } from "./build/ui/IconModal.js";

/**
 * One emoji, counted the way a person counts characters.
 *
 * Splitting by code unit cuts a flag or a skin tone in half — "👍🏽" is four
 * code units and "🇬🇧" is two code points — and half an emoji is not a
 * character, it is a replacement glyph in the middle of the list picker.
 */
describe("firstGlyph", () => {
	test("a plain emoji survives intact", () => {
		assert.equal(firstGlyph("📋"), "📋");
		assert.equal(firstGlyph("⭐"), "⭐");
	});

	test("a skin-toned emoji is not cut in half", () => {
		assert.equal(firstGlyph("👍🏽"), "👍🏽");
	});

	test("a flag is not cut in half", () => {
		// Two regional indicators that only mean a flag together.
		assert.equal(firstGlyph("🇬🇧"), "🇬🇧");
	});

	test("a zero-width-joiner sequence stays whole", () => {
		assert.equal(firstGlyph("👨‍👩‍👧"), "👨‍👩‍👧");
	});

	test("an emoji with a variation selector keeps it", () => {
		// Without the selector this renders as monochrome text, not an emoji.
		assert.equal(firstGlyph("🍽️"), "🍽️");
	});

	test("only the first glyph is kept", () => {
		assert.equal(firstGlyph("📋✅⭐"), "📋");
		assert.equal(firstGlyph("ab"), "a");
	});

	test("surrounding whitespace is ignored", () => {
		assert.equal(firstGlyph("  📋  "), "📋");
		assert.equal(firstGlyph("\n📋"), "📋");
	});

	test("empty input gives an empty icon, not a crash", () => {
		assert.equal(firstGlyph(""), "");
		assert.equal(firstGlyph("   "), "");
		assert.equal(firstGlyph("\t\n"), "");
	});

	test("a non-emoji character is allowed through", () => {
		// A letter is a poor icon but not an error, and refusing one would mean
		// deciding what counts as an emoji — a moving target not worth chasing.
		assert.equal(firstGlyph("A"), "A");
	});
});
