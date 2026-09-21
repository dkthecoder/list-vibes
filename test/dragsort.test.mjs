import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
	dropContainer,
	dropIndex,
	flowOrdinate,
	flowOrdinates,
} from "./build/ui/dragSort.js";

/**
 * The index a drag lands on. Off-by-one errors here are invisible in review and
 * glaring in use — the row lands one place from where the preview showed it —
 * so the arithmetic is pure and tested rather than eyeballed in a browser.
 *
 * Three rows, 40px tall, stacked from y=0: centres at 20, 60, 100.
 */
const CENTRES = [20, 60, 100];

describe("dropIndex", () => {
	test("a pointer that has not left its own row does not move it", () => {
		for (let from = 0; from < 3; from++) {
			assert.equal(
				dropIndex(CENTRES, from, CENTRES[from]),
				from,
				`row ${from} moved while sitting still`
			);
		}
	});

	test("dragging down lands after each row whose centre is passed", () => {
		assert.equal(dropIndex(CENTRES, 0, 30), 0, "not yet past row 1");
		assert.equal(dropIndex(CENTRES, 0, 61), 1, "just past row 1");
		assert.equal(dropIndex(CENTRES, 0, 101), 2, "just past row 2");
	});

	test("dragging up lands before each row whose centre is passed", () => {
		assert.equal(dropIndex(CENTRES, 2, 90), 2, "not yet above row 1");
		assert.equal(dropIndex(CENTRES, 2, 59), 1, "just above row 1");
		assert.equal(dropIndex(CENTRES, 2, 19), 0, "just above row 0");
	});

	test("the middle row moves in both directions", () => {
		assert.equal(dropIndex(CENTRES, 1, 10), 0);
		assert.equal(dropIndex(CENTRES, 1, 60), 1);
		assert.equal(dropIndex(CENTRES, 1, 110), 2);
	});

	test("dragging far past either end clamps instead of overshooting", () => {
		assert.equal(dropIndex(CENTRES, 0, 9999), 2);
		assert.equal(dropIndex(CENTRES, 2, -9999), 0);
		assert.equal(dropIndex(CENTRES, 1, 9999), 2);
		assert.equal(dropIndex(CENTRES, 1, -9999), 0);
	});

	test("the result is always a valid index", () => {
		for (let from = 0; from < 3; from++) {
			for (let y = -50; y <= 200; y += 7) {
				const to = dropIndex(CENTRES, from, y);
				assert.ok(
					Number.isInteger(to) && to >= 0 && to < CENTRES.length,
					`from ${from} at y ${y} gave ${to}`
				);
			}
		}
	});

	test("every reachable position is reachable from every start", () => {
		// A drag that cannot express one of the orderings is a broken drag, even
		// if every individual answer looks plausible.
		for (let from = 0; from < 3; from++) {
			const seen = new Set();
			for (let y = -50; y <= 200; y++) seen.add(dropIndex(CENTRES, from, y));
			assert.deepEqual([...seen].sort(), [0, 1, 2], `from ${from}`);
		}
	});

	test("uneven row heights are handled by centre, not by index", () => {
		// A task with steps is taller than a bare one. Only the centres matter.
		const uneven = [20, 100, 260]; // 40px, 120px, 200px tall
		assert.equal(dropIndex(uneven, 0, 99), 0, "not yet past the tall row");
		assert.equal(dropIndex(uneven, 0, 101), 1, "just past the tall row");
		assert.equal(dropIndex(uneven, 2, 99), 1);
		assert.equal(dropIndex(uneven, 2, 19), 0);
	});

	test("landing exactly on a centre resolves the same way every time", () => {
		// The pointer sitting precisely on a midpoint is a genuine tie, so the
		// answer is a convention rather than a fact: a centre counts as *not yet
		// passed*. Pinned here because both readings look correct in isolation,
		// and a silent flip would move rows one place from where the preview
		// showed them.
		assert.equal(dropIndex(CENTRES, 0, 20), 0);
		assert.equal(dropIndex(CENTRES, 0, 60), 0, "row 1's centre is not yet passed");
		assert.equal(dropIndex(CENTRES, 0, 100), 1, "row 2's centre is not yet passed");
		assert.equal(dropIndex(CENTRES, 2, 100), 2);
		assert.equal(dropIndex(CENTRES, 2, 60), 1, "row 1's centre is not yet passed");
		assert.equal(dropIndex(CENTRES, 2, 20), 0);
	});

	test("a single row has nowhere to go", () => {
		assert.equal(dropIndex([20], 0, -100), 0);
		assert.equal(dropIndex([20], 0, 100), 0);
	});

	test("no siblings at all leaves the index alone rather than throwing", () => {
		assert.equal(dropIndex([], 3, 50), 3);
	});
});

/**
 * Which container the pointer is over.
 *
 * `dropIndex` answers where a row lands within one run. A board needs the
 * question before that one: which run is being aimed at. Kept separate and pure
 * for the same reason — the arithmetic is invisible in review and obvious in
 * use, and it has to be testable without a browser.
 */
describe("dropContainer", () => {
	// Two side-by-side columns, each 100 wide and 200 tall.
	const COLUMNS = [
		{ left: 0, right: 100, top: 0, bottom: 200 },
		{ left: 120, right: 220, top: 0, bottom: 200 },
	];

	test("a pointer inside a container picks it", () => {
		assert.equal(dropContainer(COLUMNS, 50, 100, 0), 0);
		assert.equal(dropContainer(COLUMNS, 170, 100, 0), 1);
	});

	test("a pointer in the gap picks the nearer container", () => {
		assert.equal(dropContainer(COLUMNS, 105, 100, 0), 0);
		assert.equal(dropContainer(COLUMNS, 115, 100, 0), 1);
	});

	test("a pointer past the edge still picks the outermost container", () => {
		assert.equal(dropContainer(COLUMNS, -500, 100, 1), 0);
		assert.equal(dropContainer(COLUMNS, 9999, 100, 0), 1);
	});

	test("stacked bands are separated vertically, not horizontally", () => {
		const bands = [
			{ left: 0, right: 200, top: 0, bottom: 100 },
			{ left: 0, right: 200, top: 120, bottom: 220 },
		];
		assert.equal(dropContainer(bands, 100, 50, 1), 0);
		assert.equal(dropContainer(bands, 100, 200, 0), 1);
		assert.equal(dropContainer(bands, 100, 105, 0), 0);
		assert.equal(dropContainer(bands, 100, 115, 0), 1);
	});

	test("with no containers the current one is kept", () => {
		assert.equal(dropContainer([], 50, 50, 3), 3);
	});
});

/*
 * A wall of mixed-height cards in columns will eventually put two of them at
 * exactly the same height — measured on the real wall, cards 6 and 11 both sat
 * at 5546.46875. `dropIndex` orders by one number, so a tie makes its count
 * jump by two and leaves a drop position that no pointer can reach.
 */
describe("flow ordinates", () => {
	// Two columns. The third card in column one ties with the first in column
	// two, which is the shape that breaks a centre-only measure.
	const WALL = [
		{ left: 0, top: 0, height: 40 }, //    col 1, centre 20
		{ left: 0, top: 40, height: 60 }, //   col 1, centre 70
		{ left: 0, top: 100, height: 40 }, //  col 1, centre 120
		{ left: 100, top: 0, height: 40 }, //  col 2, centre 20  <- ties with #0
		{ left: 100, top: 40, height: 40 }, // col 2, centre 60
	];

	test("every card gets its own place in the order", () => {
		const o = flowOrdinates(WALL);
		assert.equal(new Set(o).size, WALL.length, "two cards share an ordinate");
		for (let i = 1; i < o.length; i++) {
			assert.ok(o[i] > o[i - 1], `ordinate ${i} does not follow ${i - 1}`);
		}
	});

	test("every drop position is reachable", () => {
		const o = flowOrdinates(WALL);
		const seen = new Set();
		for (const col of [0, 100]) {
			for (let y = -20; y < 180; y += 0.5) {
				seen.add(dropIndex(o, 0, flowOrdinate(WALL, col, y)));
			}
		}
		assert.equal(seen.size, WALL.length, `only reached ${[...seen].sort().join(",")}`);
	});

	test("in rows there is one column, so it is the centre it always was", () => {
		const rows = [
			{ left: 0, top: 0, height: 40 },
			{ left: 0, top: 40, height: 40 },
			{ left: 0, top: 80, height: 40 },
		];
		assert.deepEqual(flowOrdinates(rows), [20, 60, 100]);
	});
});
