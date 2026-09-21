import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
	parseFile,
	sortSections, sortTasks, starsOf, isStarred, PRIORITY_BY_STARS, STARS_BY_PRIORITY, partitionCompleted, orderLists, partitionStarred } from "./model.mjs";

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

/**
 * A custom order for the lists themselves.
 *
 * Task order is file order, so dragging a task is a real edit. A list has no
 * file order — the picker sorts by filename — so a custom one has to be stored,
 * and stored somewhere that is not the user's markdown. That makes it settings,
 * and settings drift: files get created, renamed and deleted while the plugin
 * is not looking, so the stored order is a preference to be honoured rather
 * than a truth to be trusted.
 */
test("a stored order is honoured", () => {
	const paths = ["a.md", "b.md", "c.md"];
	assert.deepEqual(orderLists(paths, ["c.md", "a.md", "b.md"]), ["c.md", "a.md", "b.md"]);
});

test("a list missing from the order goes to the end", () => {
	const paths = ["a.md", "b.md", "new.md"];
	assert.deepEqual(orderLists(paths, ["b.md", "a.md"]), ["b.md", "a.md", "new.md"]);
});

test("several new lists keep the order they arrived in", () => {
	const paths = ["a.md", "y.md", "z.md"];
	assert.deepEqual(orderLists(paths, ["a.md"]), ["a.md", "y.md", "z.md"]);
});

test("an order naming a list that no longer exists ignores it", () => {
	const paths = ["a.md", "b.md"];
	assert.deepEqual(orderLists(paths, ["gone.md", "b.md", "a.md"]), ["b.md", "a.md"]);
});

test("an empty order leaves the lists as they came", () => {
	const paths = ["a.md", "b.md"];
	assert.deepEqual(orderLists(paths, []), ["a.md", "b.md"]);
});

test("a duplicated entry is used once", () => {
	const paths = ["a.md", "b.md"];
	assert.deepEqual(orderLists(paths, ["b.md", "b.md", "a.md"]), ["b.md", "a.md"]);
});

/**
 * Starred tasks, lifted to the top.
 *
 * A band in the view rather than a `## Starred` heading in the file. Writing
 * one would mean moving a task's block out of its own section every time it is
 * starred, and putting it back somewhere on every unstar — which has no honest
 * answer. The band is a grouping, and groupings here are view-only.
 */
test("starred tasks are separated from the rest, in file order", () => {
	const list = parseFile(
		[
			"- [ ] plain",
			"- [ ] starred one ⏫",
			"- [ ] also plain",
			"- [ ] starred two 🔺",
		].join("\n"),
		"lists/T.md"
	);
	const { starred, rest } = partitionStarred(list.tasks);
	assert.deepEqual(starred.map((t) => t.title), ["starred one", "starred two"]);
	assert.deepEqual(rest.map((t) => t.title), ["plain", "also plain"]);
});

test("a list with nothing starred yields an empty band", () => {
	const list = parseFile("- [ ] a\n- [ ] b\n", "lists/T.md");
	const { starred, rest } = partitionStarred(list.tasks);
	assert.deepEqual(starred, []);
	assert.equal(rest.length, 2);
});

test("a completed starred task is not lifted", () => {
	const list = parseFile("- [x] done one ⏫\n- [ ] open one ⏫\n", "lists/T.md");
	const { starred } = partitionStarred(list.tasks);
	assert.deepEqual(starred.map((t) => t.title), ["open one"]);
});

test("low priorities are not stars", () => {
	const list = parseFile("- [ ] low ⏬\n- [ ] mid 🔼\n- [ ] high ⏫\n", "lists/T.md");
	const { starred } = partitionStarred(list.tasks);
	assert.deepEqual(starred.map((t) => t.title), ["high"]);
});

describe("sortSections", () => {
	const SECTIONS = [
		{ name: "Scandic", line: 4 },
		{ name: "DACH", line: 9 },
		{ name: "US / English", line: 14 },
	];
	const names = (key) => sortSections(SECTIONS, key).map((s) => s.name);

	test("file order is the file's own order, untouched", () => {
		assert.deepEqual(names("custom"), ["Scandic", "DACH", "US / English"]);
		assert.equal(sortSections(SECTIONS, "custom"), SECTIONS, "a copy was made for nothing");
	});

	test("A–Z and Z–A order the headings by name", () => {
		assert.deepEqual(names("alpha-asc"), ["DACH", "Scandic", "US / English"]);
		assert.deepEqual(names("alpha-desc"), ["US / English", "Scandic", "DACH"]);
	});

	/* A line addresses a section; two can share a name, so the line has to
	   travel with it or a rename lands on the wrong heading. */
	test("each heading keeps the line that addresses it", () => {
		const byLine = Object.fromEntries(
			sortSections(SECTIONS, "alpha-asc").map((s) => [s.name, s.line])
		);
		assert.deepEqual(byLine, { DACH: 9, Scandic: 4, "US / English": 14 });
	});

	test("two groups of the same name keep the order the file gave them", () => {
		const dupes = [
			{ name: "Same", line: 2 },
			{ name: "Other", line: 5 },
			{ name: "Same", line: 9 },
		];
		assert.deepEqual(
			sortSections(dupes, "alpha-asc").map((s) => s.line),
			[5, 2, 9]
		);
	});
});
