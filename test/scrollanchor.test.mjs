import { test } from "node:test";
import assert from "node:assert/strict";
import { pickAnchor, anchoredScrollTop } from "./build/views/scrollAnchor.js";

/*
 * Restoring a raw pixel offset across a repaint is only right when nothing above
 * the viewport changed height. Completing a task always changes it — the row
 * leaves the active list — so the offset has to be remembered against a row.
 */

const rows = [
	{ key: "a.md:1", top: 0, height: 40 },
	{ key: "a.md:2", top: 40, height: 40 },
	{ key: "a.md:3", top: 80, height: 40 },
	{ key: "a.md:4", top: 120, height: 40 },
];

test("at the top, the first row is the anchor", () => {
	assert.deepEqual(pickAnchor(rows, 0), { key: "a.md:1", offset: 0 });
});

test("scrolled to a row's own top, that row is the anchor", () => {
	assert.deepEqual(pickAnchor(rows, 80), { key: "a.md:3", offset: 0 });
});

test("scrolled into the middle of a row, that row anchors at a negative offset", () => {
	// Half of row 3 is above the top edge, so it sits 20px *before* it.
	assert.deepEqual(pickAnchor(rows, 100), { key: "a.md:3", offset: -20 });
});

test("a scroller with nothing in it has no anchor", () => {
	assert.equal(pickAnchor([], 0), null);
});

test("scrolled past every row, the last one still anchors", () => {
	assert.deepEqual(pickAnchor(rows, 400), { key: "a.md:4", offset: -280 });
});

test("a row removed above the anchor keeps the anchor where it was", () => {
	const anchor = pickAnchor(rows, 80);
	// Row 1 vanishes: everything below moves up by its 40px.
	const after = [
		{ key: "a.md:2", top: 0, height: 40 },
		{ key: "a.md:3", top: 40, height: 40 },
		{ key: "a.md:4", top: 80, height: 40 },
	];
	const moved = after.find((r) => r.key === anchor.key);
	// Raw-offset restore would have left this at 80 and shifted the view a row.
	assert.equal(anchoredScrollTop(anchor, moved.top), 40);
});

test("a row added above the anchor keeps the anchor where it was", () => {
	const anchor = pickAnchor(rows, 80);
	const after = [
		{ key: "a.md:0", top: 0, height: 40 },
		{ key: "a.md:1", top: 40, height: 40 },
		{ key: "a.md:2", top: 80, height: 40 },
		{ key: "a.md:3", top: 120, height: 40 },
	];
	const moved = after.find((r) => r.key === anchor.key);
	assert.equal(anchoredScrollTop(anchor, moved.top), 120);
});

test("the anchor is never restored above the top of the scroller", () => {
	// A partially-scrolled anchor that ends up first would otherwise ask for a
	// negative offset, which the browser clamps silently and the caller cannot see.
	assert.equal(anchoredScrollTop({ key: "a.md:3", offset: 20 }, 0), 0);
});
