import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
	shortenedAncestors,
	uncap,
	recap,
	MIN_SHORTFALL,
} from "./build/views/appCap.js";

/**
 * Finding a capped box without being told which one it is.
 *
 * Two rounds of this were spent overriding `body.is-mobile .app-container` and
 * watching the device do exactly what it did before. The arithmetic identifying
 * the fault was right both times, so what was wrong was the name — which is a
 * thing this asks the device instead of asserting.
 */
const VIEWPORT = 1355;
const KEYBOARD = 645;

/** A stand-in element: a height, and a style object that records writes. */
const box = (height, inline = {}) => ({
	height,
	style: { maxHeight: inline.maxHeight ?? "", height: inline.height ?? "" },
});
const heightOf = (el) => el.height;

describe("shortenedAncestors", () => {
	test("finds the box the keyboard was taken off twice", () => {
		const app = box(VIEWPORT - KEYBOARD);
		const leaf = box(VIEWPORT - KEYBOARD);
		const found = shortenedAncestors([leaf, app], heightOf, VIEWPORT);
		assert.deepEqual(found, [leaf, app]);
	});

	test("and leaves alone a box that merely has a header above it", () => {
		// The reading that separates the two is size. A header, a status bar or a
		// safe-area inset is tens of pixels; the thing being looked for is most
		// of a keyboard. Without a floor this would rewrite the height of every
		// box in the app on every device.
		assert.deepEqual(
			shortenedAncestors([box(VIEWPORT - 48)], heightOf, VIEWPORT),
			[]
		);
		assert.ok(MIN_SHORTFALL > 48);
	});

	test("and catches the collapsed case, which is the landscape one", () => {
		// Landscape is barely two keyboards tall, so `screen - 2 x keyboard` goes
		// negative, `max-height` clamps at zero and the whole app is blank. A
		// height of zero must read as the worst case of this fault, not as an
		// element to skip.
		assert.deepEqual(shortenedAncestors([box(0)], heightOf, VIEWPORT), [box(0)]);
	});

	test("and finds nothing when there is no viewport to compare against", () => {
		assert.deepEqual(shortenedAncestors([box(0)], heightOf, 0), []);
	});

	test("and nothing at all on a device without the fault", () => {
		// The ordinary Android case: the WebView keeps its height, core's cap is
		// correct, and every box is as tall as the viewport.
		assert.deepEqual(shortenedAncestors([box(VIEWPORT)], heightOf, VIEWPORT), []);
	});
});

describe("uncap and recap", () => {
	test("gives the box the viewport back", () => {
		const el = box(VIEWPORT - KEYBOARD);
		const saved = new Map();
		uncap(el, VIEWPORT, saved);
		assert.equal(el.style.maxHeight, `${VIEWPORT}px`);
		assert.equal(el.style.height, `${VIEWPORT}px`);
	});

	test("both properties, because which one carries the cap is not known", () => {
		const el = box(0);
		uncap(el, VIEWPORT, new Map());
		assert.notEqual(el.style.maxHeight, "");
		assert.notEqual(el.style.height, "");
	});

	test("restores exactly what was there, including nothing", () => {
		// These are Obsidian's own boxes, not ours. Leaving `height: 1355px` on
		// the app container after a rotation would be a worse bug than the one
		// being fixed, and it would outlive the view.
		const el = box(VIEWPORT - KEYBOARD);
		const saved = new Map();
		uncap(el, VIEWPORT, saved);
		recap(saved);
		assert.equal(el.style.maxHeight, "");
		assert.equal(el.style.height, "");
		assert.equal(saved.size, 0);
	});

	test("and restores an inline height it did not write", () => {
		const el = box(VIEWPORT - KEYBOARD, { height: "42px", maxHeight: "50px" });
		const saved = new Map();
		uncap(el, VIEWPORT, saved);
		recap(saved);
		assert.equal(el.style.height, "42px");
		assert.equal(el.style.maxHeight, "50px");
	});

	test("and a second pass does not overwrite the saved original", () => {
		// measure() runs on every resize and scroll event, so this happens dozens
		// of times per keyboard. Saving on each pass would record the value the
		// first pass wrote and restore the cap instead of removing it.
		const el = box(VIEWPORT - KEYBOARD, { height: "42px" });
		const saved = new Map();
		uncap(el, VIEWPORT, saved);
		uncap(el, VIEWPORT, saved);
		recap(saved);
		assert.equal(el.style.height, "42px");
	});
});
