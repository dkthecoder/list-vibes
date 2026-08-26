import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { keyboardOverlap, MAX_FRACTION, MIN_KEYBOARD } from "./build/views/keyboard.js";

/**
 * How much of the view the keyboard is covering.
 *
 * Every reported version of "everything goes blank on mobile" has come back to
 * this number, and each time the mistake was invisible: a value that is merely
 * too big does not look like a bad measurement, it looks like the view emptied
 * itself. So the readings a real device produces are written down here as
 * cases, including the ones that are not keyboards at all.
 */
const TALL = 800;

describe("keyboardOverlap", () => {
	test("no keyboard, no overlap", () => {
		assert.equal(keyboardOverlap({ native: 0, visual: 0, viewHeight: TALL }), 0);
	});

	test("Obsidian's own measurement is believed", () => {
		// Android: the webview is not resized, so the visual viewport reports
		// nothing and --keyboard-height is the only signal there is.
		assert.equal(keyboardOverlap({ native: 300, visual: 0, viewHeight: TALL }), 300);
	});

	test("the visual viewport is believed where Obsidian says nothing", () => {
		// iOS in a context where the native variable has not been written.
		assert.equal(keyboardOverlap({ native: 0, visual: 300, viewHeight: TALL }), 300);
	});

	test("with both, the larger wins", () => {
		assert.equal(keyboardOverlap({ native: 300, visual: 260, viewHeight: TALL }), 300);
		assert.equal(keyboardOverlap({ native: 260, visual: 300, viewHeight: TALL }), 300);
	});

	describe("things that are not keyboards", () => {
		test("a viewport shrunk by browser chrome is ignored", () => {
			// An address bar, a find bar, a notch. Treated as a keyboard, each
			// would leave a permanent gap at the bottom of every list.
			assert.equal(keyboardOverlap({ native: 0, visual: MIN_KEYBOARD - 1, viewHeight: TALL }), 0);
		});

		test("but a real keyboard just over the floor is not", () => {
			assert.equal(
				keyboardOverlap({ native: 0, visual: MIN_KEYBOARD, viewHeight: TALL }),
				MIN_KEYBOARD
			);
		});

		test("the floor does not apply to Obsidian's own value", () => {
			// That one is an actual platform inset rather than an inference, so a
			// small number from it is a small keyboard, not noise.
			assert.equal(keyboardOverlap({ native: 40, visual: 0, viewHeight: TALL }), 40);
		});

		test("a negative reading is a transient, not a negative keyboard", () => {
			// Seen mid-rotation and during the keyboard's own animation.
			assert.equal(keyboardOverlap({ native: -300, visual: -300, viewHeight: TALL }), 0);
		});

		test("a missing reading is not a keyboard either", () => {
			assert.equal(keyboardOverlap({ native: NaN, visual: NaN, viewHeight: TALL }), 0);
		});
	});

	describe("the clamp — the part that blanked the view", () => {
		test("a keyboard taller than the view is cut down to fit", () => {
			// A tablet: the measurement is the screen's, the pane is a fraction
			// of it. Unclamped, everything laid out from this ends up past the
			// bottom of a box that cannot scroll far enough to get it back.
			const pane = 600;
			assert.equal(
				keyboardOverlap({ native: 900, visual: 0, viewHeight: pane }),
				Math.round(pane * MAX_FRACTION)
			);
		});

		test("it never takes more than most of the view", () => {
			for (const pane of [200, 400, 600, 844, 1024]) {
				const got = keyboardOverlap({ native: 5000, visual: 5000, viewHeight: pane });
				assert.ok(got < pane, `${got} is not less than the pane's ${pane}`);
			}
		});

		test("a keyboard that already fits is not cut down", () => {
			assert.equal(keyboardOverlap({ native: 300, visual: 0, viewHeight: TALL }), 300);
		});

		test("an unknown view height passes the measurement through", () => {
			// Better than clamping to zero: a view being measured before it has
			// been laid out is a timing artefact, not a reason to ignore a real
			// keyboard.
			assert.equal(keyboardOverlap({ native: 300, visual: 0, viewHeight: 0 }), 300);
		});

		test("the answer is always a whole number of pixels", () => {
			const got = keyboardOverlap({ native: 5000, visual: 0, viewHeight: 733 });
			assert.equal(got, Math.round(got));
		});
	});
});
