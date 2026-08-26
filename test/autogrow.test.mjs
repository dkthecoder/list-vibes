import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { clampHeight, overflows, sizeToContent } from "./build/ui/autoGrow.js";

/**
 * A field as tall as what is in it, between the bounds its stylesheet set.
 *
 * The policy lives in CSS — `min-height` is the resting size, `max-height` is
 * where growing stops — so what is worth testing here is that the arithmetic
 * respects both, and that a field which grew can shrink again.
 */
const MIN = 36;
const MAX = 300;

describe("clampHeight", () => {
	test("takes the height the content wants", () => {
		assert.equal(clampHeight(120, MIN, MAX), 120);
	});

	test("never below the resting size", () => {
		// One short line must not collapse the field to the height of that line.
		assert.equal(clampHeight(12, MIN, MAX), MIN);
	});

	test("never above the ceiling", () => {
		// Past this it scrolls, so a long note cannot push the actions off the
		// bottom of a 300px panel.
		assert.equal(clampHeight(900, MIN, MAX), MAX);
	});

	test("an unmeasured field gets its resting size, not zero", () => {
		// `scrollHeight` is 0 before layout. Trusting it would collapse every
		// field on the first paint.
		assert.equal(clampHeight(0, MIN, MAX), MIN);
	});

	test("and no ceiling means no ceiling", () => {
		assert.equal(clampHeight(900, MIN, Infinity), 900);
		assert.equal(clampHeight(900, MIN, 0), 900);
	});
});

describe("overflows", () => {
	test("says so when the content did not fit", () => {
		assert.equal(overflows(900, MAX), true);
	});

	test("and not when it did", () => {
		assert.equal(overflows(120, 120), false);
	});

	test("and tolerates a rounded pixel", () => {
		// `scrollHeight` is an integer and a sub-pixel line height otherwise
		// leaves a scrollbar on a field that visibly fits.
		assert.equal(overflows(121, 120), false);
	});
});

/** A stand-in field: a style object that records writes, and a content height. */
const field = (content, applied = "") => ({
	content,
	style: { height: applied, overflowY: "" },
	get scrollHeight() {
		// The real one reports whatever height is currently set unless it has
		// been released — which is the behaviour that makes a grown field unable
		// to shrink, so the stand-in reproduces it.
		const set = parseFloat(this.style.height);
		return this.style.height === "auto" || Number.isNaN(set)
			? this.content
			: Math.max(set, this.content);
	},
});

describe("sizeToContent", () => {
	test("sizes a field to its content and hides the scrollbar", () => {
		const el = field(120);
		sizeToContent(el, { min: MIN, max: MAX });
		assert.equal(el.style.height, "120px");
		assert.equal(el.style.overflowY, "hidden");
	});

	test("caps a long one and lets it scroll", () => {
		const el = field(900);
		sizeToContent(el, { min: MIN, max: MAX });
		assert.equal(el.style.height, `${MAX}px`);
		assert.equal(el.style.overflowY, "auto");
	});

	test("and a field that grew can shrink again", () => {
		// The reason the height is released before measuring. Without that,
		// `scrollHeight` reports the height already set, deleting text leaves
		// the field at its largest, and it only ever grows.
		const el = field(200);
		sizeToContent(el, { min: MIN, max: MAX });
		assert.equal(el.style.height, "200px");
		el.content = 60;
		sizeToContent(el, { min: MIN, max: MAX });
		assert.equal(el.style.height, "60px");
	});
});
