import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_SHIFT_PX, rowShifts, nearViewport, toViewport } from "./build/views/flip.js";

/*
 * A repaint replaces the pane, so a row that changed place appears at its new
 * position with no sign of having travelled — starring a task teleports it to the
 * band at the top. These are the sums that let it be faked back to where it was
 * and released, so it slides instead.
 *
 * `dy` is how far to push the row to put it back where the eye last had it. A row
 * that moved *up* therefore gets a positive dy: it has to go back down.
 */

const at = (key, top, height = 40) => ({ key, top, height });

test("a row that moved up is pushed back down by the distance it travelled", () => {
	const before = [at("a", 120)];
	const after = [at("a", 40)];
	assert.deepEqual(rowShifts(before, after), [{ key: "a", dy: 80 }]);
});

test("a row that moved down is pushed back up", () => {
	assert.deepEqual(rowShifts([at("a", 40)], [at("a", 120)]), [{ key: "a", dy: -80 }]);
});

test("a row that stayed put is left alone", () => {
	assert.deepEqual(rowShifts([at("a", 40)], [at("a", 40)]), []);
});

test("a row that went is not animated", () => {
	assert.deepEqual(rowShifts([at("a", 40), at("b", 80)], [at("b", 40)]), [{ key: "b", dy: 40 }]);
});

test("a row that arrived is not animated — it has nowhere to come from", () => {
	assert.deepEqual(rowShifts([at("b", 40)], [at("a", 40), at("b", 80)]), [{ key: "b", dy: -40 }]);
});

test("movement too small to see is not worth a transition", () => {
	assert.deepEqual(rowShifts([at("a", 40)], [at("a", 40 + MIN_SHIFT_PX / 2)]), []);
});

test("a whole band appearing shifts everything below it by one band", () => {
	const before = [at("a", 0), at("b", 40), at("c", 80)];
	const after = [at("a", 60), at("b", 100), at("c", 140)];
	assert.deepEqual(rowShifts(before, after), [
		{ key: "a", dy: -60 },
		{ key: "b", dy: -60 },
		{ key: "c", dy: -60 },
	]);
});

test("two rows swapping places move opposite ways", () => {
	const shifts = rowShifts([at("a", 0), at("b", 40)], [at("b", 0), at("a", 40)]);
	assert.deepEqual(shifts.find((s) => s.key === "a"), { key: "a", dy: -40 });
	assert.deepEqual(shifts.find((s) => s.key === "b"), { key: "b", dy: 40 });
});

/*
 * A row well off the end of a long list slides where nobody is looking. Bounding
 * the work to what is on screen, plus a margin so a row scrolled into mid-flight
 * is already moving, keeps a 500-row list from animating 500 rows.
 */

const TEN = Array.from({ length: 10 }, (_, i) => at(`r${i}`, i * 40));

test("a row on screen is worth animating", () => {
	const keys = nearViewport(TEN, 0, 200, 0).map((r) => r.key);
	assert.deepEqual(keys, ["r0", "r1", "r2", "r3", "r4"]);
});

test("a row far below the fold is not", () => {
	assert.equal(
		nearViewport(TEN, 0, 200, 0).some((r) => r.key === "r9"),
		false
	);
});

test("a row scrolled past above is not either", () => {
	const keys = nearViewport(TEN, 200, 200, 0).map((r) => r.key);
	assert.deepEqual(keys, ["r5", "r6", "r7", "r8", "r9"]);
});

test("the margin reaches past the fold, so a row scrolled into is already moving", () => {
	const keys = nearViewport(TEN, 0, 200, 80).map((r) => r.key);
	assert.deepEqual(keys, ["r0", "r1", "r2", "r3", "r4", "r5", "r6"]);
});

test("a row straddling the top edge counts as on screen", () => {
	// Scrolled to 100: r2 spans 80-120, so half of it shows.
	assert.equal(
		nearViewport(TEN, 100, 200, 0).some((r) => r.key === "r2"),
		true
	);
});

test("an empty scroller has nothing to animate", () => {
	assert.deepEqual(nearViewport([], 0, 200, 80), []);
});

/*
 * The slide has to be measured against the viewport, not against the content.
 *
 * The scroll anchor already moves the scroller to hold the reader's row still
 * when something above it changes height. In content space that row *did* move —
 * so measuring there would animate a slide for a row that visibly never moved,
 * and the two features would fight.
 */

test("a row's place is reported relative to what is on screen", () => {
	assert.deepEqual(toViewport([at("a", 120)], 80), [{ key: "a", top: 40, height: 40 }]);
});

test("a row the scroll anchor held still shows no movement", () => {
	// Content moved up 40px; the anchor moved the scroller up 40px to match.
	const before = toViewport([at("a", 120)], 120);
	const after = toViewport([at("a", 80)], 80);
	assert.deepEqual(rowShifts(before, after), []);
});

test("a row that genuinely moved on screen still reports it", () => {
	// Starred: lifted to the top of the list while the scroller stayed put.
	const before = toViewport([at("a", 200)], 100);
	const after = toViewport([at("a", 0)], 100);
	assert.deepEqual(rowShifts(before, after), [{ key: "a", dy: 200 }]);
});

test("an unscrolled scroller reports content positions unchanged", () => {
	assert.deepEqual(toViewport([at("a", 40)], 0), [at("a", 40)]);
});
