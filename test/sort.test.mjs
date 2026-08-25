import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFile, sortTasks, starsOf, isStarred, PRIORITY_BY_STARS, STARS_BY_PRIORITY, partitionCompleted } from "./model.mjs";

const MD = [
	"- [ ] Banana 📅 2026-09-05 ➕ 2026-01-03 🔼",
	"- [ ] apple 📅 2026-09-01 ➕ 2026-01-05 ⏬",
	"- [ ] Cherry ➕ 2026-01-01 🔺",
	"- [ ] date ⏫",
	"- [ ] Elderberry 📅 2026-09-03",
	"- [x] fig ✅ 2026-08-01 ⏫",
].join("\n");

const list = () => parseFile(MD, "x.md").tasks;
const titles = (ts) => ts.map((t) => t.title);

test("star scale: 5 is highest, 1 is lowest", () => {
	assert.equal(STARS_BY_PRIORITY.highest, 5);
	assert.equal(STARS_BY_PRIORITY.high, 4);
	assert.equal(STARS_BY_PRIORITY.medium, 3);
	assert.equal(STARS_BY_PRIORITY.low, 2);
	assert.equal(STARS_BY_PRIORITY.lowest, 1);
	assert.equal(PRIORITY_BY_STARS[0], undefined);
	assert.equal(PRIORITY_BY_STARS[5], "highest");
	assert.equal(PRIORITY_BY_STARS[1], "lowest");
});

test("stars and priority round-trip through each other", () => {
	for (const [priority, stars] of Object.entries(STARS_BY_PRIORITY)) {
		assert.equal(PRIORITY_BY_STARS[stars], priority);
	}
});

test("starsOf reads a task, 0 when unset", () => {
	const [banana, apple, cherry, date, elder] = list();
	assert.equal(starsOf(cherry), 5);
	assert.equal(starsOf(date), 4);
	assert.equal(starsOf(banana), 3);
	assert.equal(starsOf(apple), 1);
	assert.equal(starsOf(elder), 0);
});

test("the single star covers high and highest only", () => {
	const [banana, apple, cherry, date, elder] = list();
	assert.equal(isStarred(cherry), true, "highest should read as starred");
	assert.equal(isStarred(date), true, "high should read as starred");
	assert.equal(isStarred(banana), false, "medium should not");
	assert.equal(isStarred(apple), false);
	assert.equal(isStarred(elder), false);
});

test("custom order is the file's own order, untouched", () => {
	assert.deepEqual(titles(sortTasks(list(), "custom")), titles(list()));
});

test("importance sorts most important first, unset last", () => {
	assert.deepEqual(titles(sortTasks(list(), "importance")), [
		"Cherry",     // 5
		"date",       // 4
		"fig",        // 4
		"Banana",     // 3
		"apple",      // 1
		"Elderberry", // none
	]);
});

test("due sorts soonest first and pushes undated to the end", () => {
	assert.deepEqual(titles(sortTasks(list(), "due")), [
		"apple",      // 09-01
		"Elderberry", // 09-03
		"Banana",     // 09-05
		"Cherry",     // none
		"date",       // none
		"fig",        // none
	]);
});

test("created newest first, undated last", () => {
	assert.deepEqual(titles(sortTasks(list(), "created-desc")), [
		"apple",      // 01-05
		"Banana",     // 01-03
		"Cherry",     // 01-01
		"date",
		"Elderberry",
		"fig",
	]);
});

test("created oldest first, undated last", () => {
	assert.deepEqual(titles(sortTasks(list(), "created-asc")), [
		"Cherry",
		"Banana",
		"apple",
		"date",
		"Elderberry",
		"fig",
	]);
});

test("alphabetical ignores case", () => {
	assert.deepEqual(titles(sortTasks(list(), "alpha-asc")), [
		"apple",
		"Banana",
		"Cherry",
		"date",
		"Elderberry",
		"fig",
	]);
	assert.deepEqual(titles(sortTasks(list(), "alpha-desc")), [
		"fig",
		"Elderberry",
		"date",
		"Cherry",
		"Banana",
		"apple",
	]);
});

test("sorting is stable: ties keep file order", () => {
	const md = ["- [ ] first", "- [ ] second", "- [ ] third"].join("\n");
	const ts = parseFile(md, "x.md").tasks;
	// No priorities at all, so every comparison ties.
	assert.deepEqual(titles(sortTasks(ts, "importance")), ["first", "second", "third"]);
	assert.deepEqual(titles(sortTasks(ts, "due")), ["first", "second", "third"]);
});

test("sorting never mutates the input array", () => {
	const ts = list();
	const before = titles(ts);
	sortTasks(ts, "alpha-desc");
	assert.deepEqual(titles(ts), before, "sortTasks mutated its argument");
});

test("sorting is view-only and does not touch raw lines", () => {
	const ts = list();
	const sorted = sortTasks(ts, "importance");
	for (const t of sorted) {
		const original = ts.find((o) => o.line === t.line);
		assert.equal(t.raw, original.raw);
	}
});

test("partitionCompleted splits while preserving order", () => {
	const sorted = sortTasks(list(), "alpha-asc");
	const { open, done } = partitionCompleted(sorted);
	assert.deepEqual(titles(open), ["apple", "Banana", "Cherry", "date", "Elderberry"]);
	assert.deepEqual(titles(done), ["fig"]);
});

test("numeric-aware collation orders 2 before 10", () => {
	const md = ["- [ ] Item 10", "- [ ] Item 2", "- [ ] Item 1"].join("\n");
	const ts = parseFile(md, "x.md").tasks;
	assert.deepEqual(titles(sortTasks(ts, "alpha-asc")), ["Item 1", "Item 2", "Item 10"]);
});
