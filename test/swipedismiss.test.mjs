import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
	beginsSwipe,
	settle,
	offsetFor,
	SLOP,
	COMMIT,
	FLICK_DISTANCE,
	FLICK_VELOCITY,
} from "./build/ui/swipeDismiss.js";

/**
 * Swiping the detail panel away.
 *
 * Both decisions here are the kind that feel wrong long before anyone can say
 * why: a threshold slightly too low and the list stops scrolling because every
 * drag steals the gesture; slightly too high and the panel refuses to go. That
 * makes them worth pinning down in arithmetic rather than in a thumb.
 */

describe("beginsSwipe — is this a swipe or a scroll?", () => {
	test("a touch that has barely moved is neither", () => {
		assert.equal(beginsSwipe(0, 0), false);
		assert.equal(beginsSwipe(SLOP - 1, 0), false, "just short of the slop");
	});

	test("a clean horizontal drag past the slop is a swipe", () => {
		assert.equal(beginsSwipe(SLOP, 0), true);
		assert.equal(beginsSwipe(80, 0), true);
	});

	test("dragging left is not a swipe — the panel has nowhere to go", () => {
		assert.equal(beginsSwipe(-80, 0), false);
	});

	test("a vertical drag is a scroll however far it goes", () => {
		assert.equal(beginsSwipe(0, 200), false);
		assert.equal(beginsSwipe(0, -200), false);
	});

	test("a scroll that wanders sideways stays a scroll", () => {
		// 20px across, 60px down: a thumb travelling up the panel.
		assert.equal(beginsSwipe(20, 60), false);
		assert.equal(beginsSwipe(20, -60), false, "upwards is no different");
	});

	test("at parity the scroll wins", () => {
		// Deliberate: an interrupted scroll is more annoying than a swipe that
		// needs another millimetre to be believed.
		assert.equal(beginsSwipe(40, 40), false);
		assert.equal(beginsSwipe(40, -40), false);
	});

	test("a clearly diagonal drag that favours across is a swipe", () => {
		assert.equal(beginsSwipe(60, 40), true);
	});

	test("the slop can be overridden without changing the direction rule", () => {
		assert.equal(beginsSwipe(4, 0, 2), true);
		assert.equal(beginsSwipe(-4, 0, 2), false);
	});
});

describe("settle — does it go, or come back?", () => {
	const WIDTH = 300;
	const SLOW = 2000; // long enough that velocity is never the reason

	test("letting go near the start brings it back", () => {
		assert.equal(settle(10, WIDTH, SLOW), "return");
	});

	test("dragging most of the way across dismisses it, however slowly", () => {
		assert.equal(settle(WIDTH * COMMIT, WIDTH, SLOW), "dismiss");
		assert.equal(settle(WIDTH - 1, WIDTH, SLOW), "dismiss");
	});

	test("one pixel short of the commit point does not", () => {
		assert.equal(settle(WIDTH * COMMIT - 1, WIDTH, SLOW), "return");
	});

	test("a short fast flick dismisses even though it never got far", () => {
		// The whole reason there are two tests rather than one: this gesture is
		// only 40px and distance alone would ignore it.
		assert.equal(settle(FLICK_DISTANCE + 8, WIDTH, 60), "dismiss");
	});

	test("a short slow push does not", () => {
		assert.equal(settle(FLICK_DISTANCE + 8, WIDTH, 2000), "return");
	});

	test("a flick has to clear both the distance and the speed", () => {
		const fastEnough = 50;
		assert.equal(
			settle(FLICK_DISTANCE - 1, WIDTH, (FLICK_DISTANCE - 1) / FLICK_VELOCITY),
			"return",
			"fast but hardly moved"
		);
		assert.equal(
			settle(fastEnough, WIDTH, fastEnough / (FLICK_VELOCITY / 2)),
			"return",
			"far enough but half the speed"
		);
	});

	test("a zero-length interval is a clock artefact, not infinite speed", () => {
		// dx/0 is Infinity, which would dismiss the panel on any stray touch
		// that registered two events in the same millisecond.
		assert.equal(settle(FLICK_DISTANCE + 1, WIDTH, 0), "return");
		assert.equal(settle(FLICK_DISTANCE + 1, WIDTH, -5), "return");
	});

	test("a panel of unknown width still answers on the flick", () => {
		// getBoundingClientRect can return 0 while a panel is being torn down.
		assert.equal(settle(200, 0, 2000), "return", "no width, no commit fraction");
		assert.equal(settle(200, 0, 100), "dismiss", "but a flick is a flick");
	});
});

describe("offsetFor — where the panel actually sits", () => {
	test("it never goes left of home", () => {
		assert.equal(offsetFor(-50, 300), 0);
		assert.equal(offsetFor(0, 300), 0);
	});

	test("it follows the finger", () => {
		assert.equal(offsetFor(120, 300), 120);
	});

	test("it stops once it is off screen", () => {
		// Otherwise a long drag leaves the release animation starting from
		// somewhere far outside the pane, and it appears to fly back in.
		assert.equal(offsetFor(900, 300), 300);
	});

	test("with no width it just follows the finger", () => {
		assert.equal(offsetFor(120, 0), 120);
	});
});
