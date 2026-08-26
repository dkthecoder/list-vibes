import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { keyboardOverlap, visibleCap, MAX_FRACTION, MIN_KEYBOARD } from "./build/views/keyboard.js";

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

/**
 * Keeping the view on the part of the screen that is on screen.
 *
 * "The whole screen gets pushed up when the keyboard rises" is what a browser
 * does when a focused field is under the keyboard and nothing can scroll to
 * reveal it: it scrolls the page itself, chrome and all, and leaves blank space
 * behind. Three previous fixes tried to prevent it by subtracting the keyboard's
 * height — which is wrong whenever Obsidian has already subtracted it, and that
 * double subtraction is what collapsed the pane.
 *
 * So this asks a different question, one that cannot be double-counted: does the
 * view currently extend past what is visible, and by how much.
 */
describe("visibleCap", () => {
	test("a view that already fits is left alone", () => {
		// Obsidian shortened `.app-container` for the keyboard, so there is
		// nothing left to do and any adjustment here would be the second one.
		assert.equal(visibleCap({ top: 100, bottom: 500, visibleBottom: 500 }), null);
		assert.equal(visibleCap({ top: 100, bottom: 400, visibleBottom: 500 }), null);
	});

	test("a view hanging past the fold is capped to reach exactly the fold", () => {
		// Obsidian did not make room — so the shortfall, and only the shortfall,
		// is taken off.
		assert.equal(visibleCap({ top: 100, bottom: 844, visibleBottom: 500 }), 400);
	});

	test("applying the cap is idempotent", () => {
		// The property that stops it walking the view down to nothing: cap, then
		// measure the capped view, and the answer is "already fits" rather than
		// a second, smaller cap. This only holds because the cap is an absolute
		// height rather than a reduction.
		const top = 100;
		const cap = visibleCap({ top, bottom: 844, visibleBottom: 500 });
		assert.equal(cap, 400);
		assert.equal(visibleCap({ top, bottom: top + cap, visibleBottom: 500 }), null);
	});

	test("sub-pixel overhang is not a fault", () => {
		assert.equal(visibleCap({ top: 0, bottom: 500.5, visibleBottom: 500 }), null);
		assert.equal(visibleCap({ top: 0, bottom: 600, visibleBottom: 500 }), 500);
	});

	test("the slack can be tightened", () => {
		assert.equal(visibleCap({ top: 0, bottom: 502, visibleBottom: 500, slack: 0 }), 500);
	});

	test("a view whose top is already past the fold is not capped to nothing", () => {
		// Making it shorter cannot rescue it, and a cap of zero or less would
		// hide whatever of it is still on screen.
		assert.equal(visibleCap({ top: 600, bottom: 900, visibleBottom: 500 }), null);
		assert.equal(visibleCap({ top: 500, bottom: 900, visibleBottom: 500 }), null);
	});

	test("a missing measurement means no cap rather than a guessed one", () => {
		assert.equal(visibleCap({ top: NaN, bottom: 900, visibleBottom: 500 }), null);
		assert.equal(visibleCap({ top: 0, bottom: NaN, visibleBottom: 500 }), null);
		assert.equal(visibleCap({ top: 0, bottom: 900, visibleBottom: NaN }), null);
	});

	test("a page scrolled up is measured in the same coordinates", () => {
		// getBoundingClientRect is relative to the layout viewport and
		// visualViewport.offsetTop is the visual viewport's offset within it, so
		// visibleBottom = offsetTop + height puts both on the same ruler. A view
		// pushed up by 200 has a negative top, and the cap has to account for it.
		const offsetTop = 200, vvHeight = 500;
		assert.equal(
			visibleCap({ top: -200, bottom: 900, visibleBottom: offsetTop + vvHeight }),
			900,
			"a view starting 200 above the fold has 900px of room below it"
		);
	});

	test("the cap is a whole number of pixels", () => {
		const got = visibleCap({ top: 10.4, bottom: 900, visibleBottom: 500.9 });
		assert.equal(got, Math.floor(got));
	});
});
