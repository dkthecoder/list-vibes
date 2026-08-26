import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
	subtractsTwice,
	restingHeightAfter,
	RESIZE_SHARE,
} from "./build/views/doubleKeyboard.js";

/**
 * Telling a keyboard that has been subtracted once from one subtracted twice.
 *
 * The consequence of getting this wrong is not subtle in either direction:
 * miss it and the app collapses on the devices that resize their WebView;
 * claim it falsely and core's cap is overridden on every device that does not,
 * leaving the keyboard covering the bottom of the app for everyone.
 */
const KEYBOARD = 700;
const TALL = 2000;

describe("subtractsTwice", () => {
	test("no keyboard, nothing to double", () => {
		assert.equal(
			subtractsTwice({ innerHeight: TALL, restingHeight: TALL, keyboard: 0 }),
			false
		);
	});

	test("the usual Android case: the viewport did not move", () => {
		// The WebView keeps its height and the keyboard is drawn over it, so
		// `100vh` still spans the screen and core's single subtraction is right.
		assert.equal(
			subtractsTwice({ innerHeight: TALL, restingHeight: TALL, keyboard: KEYBOARD }),
			false
		);
	});

	test("the reported device: the viewport shrank by a keyboard as well", () => {
		assert.equal(
			subtractsTwice({
				innerHeight: TALL - KEYBOARD,
				restingHeight: TALL,
				keyboard: KEYBOARD,
			}),
			true
		);
	});

	test("a resize that does not quite match a keyboard still counts", () => {
		// Navigation bars, display cutouts and suggestion strips all move this by
		// tens of pixels. The two cases being separated are "shrank by roughly a
		// keyboard" and "did not shrink", which is not a close call.
		assert.equal(
			subtractsTwice({
				innerHeight: TALL - Math.ceil(KEYBOARD * RESIZE_SHARE),
				restingHeight: TALL,
				keyboard: KEYBOARD,
			}),
			true
		);
	});

	test("a small wobble is not a resize", () => {
		// A toolbar appearing, or a rounding difference. Treated as a resize it
		// would override core's cap on a device where core is right.
		assert.equal(
			subtractsTwice({ innerHeight: TALL - 40, restingHeight: TALL, keyboard: KEYBOARD }),
			false
		);
	});

	test("a viewport that grew is a rotation, not a keyboard", () => {
		assert.equal(
			subtractsTwice({ innerHeight: TALL + 200, restingHeight: TALL, keyboard: KEYBOARD }),
			false
		);
	});

	test("nothing is claimed before a resting height is known", () => {
		// On the very first reading there is no baseline, and guessing here would
		// override core's rule on the strength of no evidence at all.
		assert.equal(
			subtractsTwice({ innerHeight: 1300, restingHeight: 0, keyboard: KEYBOARD }),
			false
		);
	});

	test("landscape, where the same fault empties the screen", () => {
		// A landscape screen is barely two keyboards tall, so the second
		// subtraction clamps `max-height` at zero.
		const wide = 1200, kb = 600;
		assert.equal(
			subtractsTwice({ innerHeight: wide - kb, restingHeight: wide, keyboard: kb }),
			true
		);
	});
});

describe("restingHeightAfter", () => {
	test("it learns the height while no keyboard is up", () => {
		assert.equal(restingHeightAfter(0, TALL, 0, false), TALL);
		assert.equal(restingHeightAfter(TALL, TALL, 0, false), TALL);
	});

	test("it takes the tallest it has seen", () => {
		// A toolbar or a banner can make one reading short; the resting height is
		// the screen without a keyboard, not the smallest glimpse of it.
		assert.equal(restingHeightAfter(TALL, TALL - 100, 0, false), TALL);
	});

	test("it does not learn while the keyboard is up", () => {
		assert.equal(restingHeightAfter(TALL, TALL - KEYBOARD, KEYBOARD, false), TALL);
	});

	test("and especially not before a resting height is known", () => {
		// The case that matters, and the one a running maximum hides: with no
		// baseline yet, learning the shrunken height records it *as* the resting
		// height. The shrink then computes as zero for ever after and the fault
		// is never detected — silently, on exactly the devices that have it.
		assert.equal(restingHeightAfter(0, TALL - KEYBOARD, KEYBOARD, false), 0);
	});

	test("a rotation forgets it, because landscape is not portrait", () => {
		// Carried across a rotation, a portrait resting height would make every
		// landscape reading look like a shrinking viewport and override core's
		// cap permanently.
		assert.equal(restingHeightAfter(TALL, 1200, 0, true), 1200);
	});

	test("and a rotation with the keyboard already up waits for a clean reading", () => {
		assert.equal(restingHeightAfter(TALL, 600, 400, true), 0);
	});
});
