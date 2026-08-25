import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseRule, nextDate, nextOccurrence, parseISO } from "./model.mjs";

describe("parseRule", () => {
	test("the plain units", () => {
		for (const [text, unit] of [
			["every day", "day"],
			["every week", "week"],
			["every month", "month"],
			["every year", "year"],
		]) {
			assert.deepEqual(parseRule(text), { every: 1, unit, whenDone: false });
		}
	});

	test("the -ly forms, with or without every", () => {
		assert.deepEqual(parseRule("daily"), { every: 1, unit: "day", whenDone: false });
		assert.deepEqual(parseRule("weekly"), { every: 1, unit: "week", whenDone: false });
		assert.deepEqual(parseRule("every monthly"), { every: 1, unit: "month", whenDone: false });
	});

	test("a count", () => {
		assert.deepEqual(parseRule("every 3 days"), { every: 3, unit: "day", whenDone: false });
		assert.deepEqual(parseRule("every 2 weeks"), { every: 2, unit: "week", whenDone: false });
	});

	test('"every other" means two', () => {
		assert.deepEqual(parseRule("every other week"), { every: 2, unit: "week", whenDone: false });
	});

	test("a weekday", () => {
		assert.deepEqual(parseRule("every monday"), {
			every: 1, unit: "week", whenDone: false, weekday: 1,
		});
		assert.deepEqual(parseRule("every sunday"), {
			every: 1, unit: "week", whenDone: false, weekday: 0,
		});
	});

	test('"when done" is picked up and stripped', () => {
		assert.deepEqual(parseRule("every 3 days when done"), {
			every: 3, unit: "day", whenDone: true,
		});
	});

	test("case and spacing do not matter", () => {
		assert.deepEqual(parseRule("  EVERY  2   WEEKS  "), {
			every: 2, unit: "week", whenDone: false,
		});
	});

	test("anything unrecognised returns null rather than guessing", () => {
		// A task that repeats on the wrong schedule is worse than one that does
		// not repeat: the first is silent, the second is obvious.
		for (const bad of [
			"", "   ", "every", "every fortnight", "every 0 days", "every -1 days",
			"on tuesdays", "twice a week", "every blue moon", "every 2",
		]) {
			assert.equal(parseRule(bad), null, `for ${JSON.stringify(bad)}`);
		}
	});
});

describe("nextDate", () => {
	const rule = (text) => parseRule(text);

	test("days and weeks", () => {
		assert.equal(nextDate(rule("every day"), "2026-03-01"), "2026-03-02");
		assert.equal(nextDate(rule("every 3 days"), "2026-03-01"), "2026-03-04");
		assert.equal(nextDate(rule("every week"), "2026-03-01"), "2026-03-08");
		assert.equal(nextDate(rule("every 2 weeks"), "2026-03-01"), "2026-03-15");
	});

	test("a month keeps the day of the month", () => {
		assert.equal(nextDate(rule("every month"), "2026-03-15"), "2026-04-15");
		assert.equal(nextDate(rule("every 2 months"), "2026-01-10"), "2026-03-10");
	});

	test("a month clamps rather than overflowing", () => {
		// THE trap: setMonth on 31 January gives 3 March, so "every month" on the
		// 31st would creep forward through the calendar. It must land on the last
		// day of the target month instead.
		assert.equal(nextDate(rule("every month"), "2026-01-31"), "2026-02-28");
		assert.equal(nextDate(rule("every month"), "2026-03-31"), "2026-04-30");
		assert.equal(nextDate(rule("every month"), "2026-05-31"), "2026-06-30");
	});

	test("February in a leap year", () => {
		assert.equal(nextDate(rule("every month"), "2028-01-31"), "2028-02-29");
		assert.equal(nextDate(rule("every year"), "2028-02-29"), "2029-02-28");
	});

	test("a repeating month does not drift", () => {
		// Clamping must not become permanent: after February, the 31st-of-the-
		// month task has to go back to the 31st, not stay on the 28th.
		let d = "2026-01-31";
		const seen = [];
		for (let i = 0; i < 4; i++) {
			d = nextDate(rule("every month"), d);
			seen.push(d);
		}
		assert.deepEqual(seen, ["2026-02-28", "2026-03-28", "2026-04-28", "2026-05-28"]);
	});

	test("years", () => {
		assert.equal(nextDate(rule("every year"), "2026-08-25"), "2027-08-25");
	});

	test("a weekday moves to the next one, never staying put", () => {
		// 2026-08-24 is a Monday.
		assert.equal(parseISO("2026-08-24").getUTCDay(), 1);
		assert.equal(nextDate(rule("every monday"), "2026-08-24"), "2026-08-31");
		assert.equal(nextDate(rule("every friday"), "2026-08-24"), "2026-08-28");
		assert.equal(nextDate(rule("every sunday"), "2026-08-24"), "2026-08-30");
	});

	test("every other monday skips a week", () => {
		assert.equal(nextDate(rule("every other monday"), "2026-08-24"), "2026-09-07");
	});

	test("a malformed date gives null", () => {
		assert.equal(nextDate(rule("every day"), "not a date"), null);
		assert.equal(nextDate(rule("every day"), "2026-02-30"), null);
		assert.equal(nextDate(rule("every day"), "2026-13-01"), null);
	});
});

describe("nextOccurrence", () => {
	test("counts from the due date by default", () => {
		// Rent is due on the first whether or not it was paid late.
		assert.deepEqual(
			nextOccurrence("every month", { due: "2026-03-01" }, "2026-03-09"),
			{ due: "2026-04-01" }
		);
	});

	test('"when done" counts from the completion date instead', () => {
		// Water the plants three days after you last watered them.
		assert.deepEqual(
			nextOccurrence("every 3 days when done", { due: "2026-03-01" }, "2026-03-09"),
			{ due: "2026-03-12" }
		);
	});

	test("the gap between scheduled and due is preserved", () => {
		// Scheduled two days before due, and it must stay two days before due.
		assert.deepEqual(
			nextOccurrence(
				"every week",
				{ due: "2026-03-08", scheduled: "2026-03-06" },
				"2026-03-08"
			),
			{ due: "2026-03-15", scheduled: "2026-03-13" }
		);
	});

	test("a scheduled-only task advances its scheduled date", () => {
		assert.deepEqual(
			nextOccurrence("every week", { scheduled: "2026-03-06" }, "2026-03-06"),
			{ scheduled: "2026-03-13" }
		);
	});

	test("a task with no dates at all starts from completion", () => {
		assert.deepEqual(
			nextOccurrence("every week", {}, "2026-03-09"),
			{ due: "2026-03-16" }
		);
	});

	test("an unrecognised rule advances nothing", () => {
		assert.equal(nextOccurrence("every blue moon", { due: "2026-03-01" }, "2026-03-01"), null);
		assert.equal(nextOccurrence("", { due: "2026-03-01" }, "2026-03-01"), null);
	});

	test("a malformed date advances nothing rather than inventing one", () => {
		assert.equal(nextOccurrence("every week", { due: "March 1st" }, "2026-03-01"), null);
	});
});
