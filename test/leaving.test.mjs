import { test } from "node:test";
import assert from "node:assert/strict";
import {
	LINGER_MS,
	LEAVE_MS,
	leavingKey,
	markLeaving,
	clearLeaving,
	isLeaving,
	leavingAge,
	pruneLeaving,
	shiftLeaving,
	LIFT_MS,
} from "./build/views/leaving.js";

/*
 * A completed task is written to the file at once, but stays in the active list
 * for a grace period so a mistaken tick can be taken back. This is the
 * bookkeeping for that window — the timing only, no DOM.
 */

test("a task just ticked is on its way out", () => {
	const m = new Map();
	markLeaving(m, "a.md:3", 1000);
	assert.equal(isLeaving(m, "a.md:3", 1000), true);
});

test("a task nobody ticked is not", () => {
	assert.equal(isLeaving(new Map(), "a.md:3", 1000), false);
});

test("it is still leaving part way through the window", () => {
	const m = new Map();
	markLeaving(m, "a.md:3", 1000);
	assert.equal(isLeaving(m, "a.md:3", 1000 + LINGER_MS), true);
});

test("once the window is up it is gone", () => {
	const m = new Map();
	markLeaving(m, "a.md:3", 1000);
	assert.equal(isLeaving(m, "a.md:3", 1000 + LEAVE_MS), false);
});

test("unticking inside the window takes it off the list", () => {
	const m = new Map();
	markLeaving(m, "a.md:3", 1000);
	clearLeaving(m, "a.md:3");
	assert.equal(isLeaving(m, "a.md:3", 1100), false);
});

test("age drives the animation, so it reports the time elapsed", () => {
	const m = new Map();
	markLeaving(m, "a.md:3", 1000);
	assert.equal(leavingAge(m, "a.md:3", 1450), 450);
});

test("a task not leaving has no age", () => {
	assert.equal(leavingAge(new Map(), "a.md:3", 1000), null);
});

test("pruning drops what has expired and says it did", () => {
	const m = new Map();
	markLeaving(m, "a.md:1", 1000);
	markLeaving(m, "a.md:2", 5000);
	assert.equal(pruneLeaving(m, 1000 + LEAVE_MS), true);
	assert.deepEqual([...m.keys()], ["a.md:2"]);
});

test("pruning with nothing expired changes nothing", () => {
	const m = new Map();
	markLeaving(m, "a.md:1", 1000);
	assert.equal(pruneLeaving(m, 1100), false);
	assert.equal(m.size, 1);
});

/*
 * Completing a repeating task inserts the next occurrence above it, so every
 * line from that point down moves. Without this the key points at a line that
 * has become a different task, and the wrong row lingers.
 */

test("a line inserted above a leaving task follows it down", () => {
	const m = new Map();
	markLeaving(m, leavingKey("a.md", 5), 1000);
	shiftLeaving(m, "a.md", 5, 1);
	assert.equal(isLeaving(m, leavingKey("a.md", 6), 1000), true);
	assert.equal(isLeaving(m, leavingKey("a.md", 5), 1000), false);
});

test("a line inserted below a leaving task leaves it alone", () => {
	const m = new Map();
	markLeaving(m, leavingKey("a.md", 5), 1000);
	shiftLeaving(m, "a.md", 9, 1);
	assert.equal(isLeaving(m, leavingKey("a.md", 5), 1000), true);
});

test("shifting one file does not move another file's rows", () => {
	const m = new Map();
	markLeaving(m, leavingKey("a.md", 5), 1000);
	markLeaving(m, leavingKey("b.md", 5), 1000);
	shiftLeaving(m, "a.md", 1, 1);
	assert.equal(isLeaving(m, leavingKey("b.md", 5), 1000), true);
});

test("the age survives being shifted", () => {
	const m = new Map();
	markLeaving(m, leavingKey("a.md", 5), 1000);
	shiftLeaving(m, "a.md", 5, 1);
	assert.equal(leavingAge(m, leavingKey("a.md", 6), 1450), 450);
});

test("a path containing a colon still keys unambiguously", () => {
	const m = new Map();
	markLeaving(m, leavingKey("lists/9:30 standup.md", 2), 1000);
	assert.equal(isLeaving(m, leavingKey("lists/9:30 standup.md", 2), 1000), true);
	assert.equal(isLeaving(m, leavingKey("lists/9", 30), 1000), false);
});

/*
 * The star gets a shorter hold than a tick does. A tick has to be undoable after
 * the row has been crossed out and is about to go; a star only has to be visible
 * where it was pressed before the row travels, so half a second is plenty.
 */

test("the star's hold is shorter than a tick's", () => {
	assert.ok(LIFT_MS < LEAVE_MS, `${LIFT_MS} should be under ${LEAVE_MS}`);
});

test("a window can be given, for holds that are not a tick", () => {
	const m = new Map();
	markLeaving(m, "a.md:3", 1000);
	assert.equal(isLeaving(m, "a.md:3", 1000 + LIFT_MS - 1, LIFT_MS), true);
	assert.equal(isLeaving(m, "a.md:3", 1000 + LIFT_MS, LIFT_MS), false);
});

test("and pruning honours the same window", () => {
	const m = new Map();
	markLeaving(m, "a.md:3", 1000);
	assert.equal(pruneLeaving(m, 1000 + LIFT_MS, LIFT_MS), true);
	assert.equal(m.size, 0);
});

test("the default window is still a tick's, so existing callers are unchanged", () => {
	const m = new Map();
	markLeaving(m, "a.md:3", 1000);
	assert.equal(isLeaving(m, "a.md:3", 1000 + LIFT_MS), true);
});
