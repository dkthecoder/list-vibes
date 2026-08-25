/**
 * Repeating tasks.
 *
 * Ticking a `🔁 every week` task should leave the next one behind. Until now
 * the rule was parsed and displayed and then ignored, so completing a repeating
 * task just ended it.
 *
 * Everything here is pure date arithmetic on `YYYY-MM-DD` strings. No Obsidian,
 * no Date-object plumbing escaping the module, and no `Date.now()` — the caller
 * supplies today. That keeps it testable, which matters more here than almost
 * anywhere else in the plugin: month arithmetic has a well-known trap, and the
 * cost of getting it wrong is a task that silently reschedules itself to the
 * wrong day forever.
 */

export type Unit = "day" | "week" | "month" | "year";

export interface Rule {
	/** How many units forward each time. `every 2 weeks` is 2. */
	every: number;
	unit: Unit;
	/**
	 * Count from the completion date rather than the task's own due date.
	 *
	 * Obsidian Tasks spells this `when done`, and the distinction is the whole
	 * point of the feature: "water the plants every 3 days" means three days
	 * after you last watered them, whereas "rent due every month" means the
	 * first of the month whether you paid late or not.
	 */
	whenDone: boolean;
	/** For `every monday`: 0 = Sunday, matching Date.getUTCDay(). */
	weekday?: number;
}

const WEEKDAYS: Record<string, number> = {
	sunday: 0,
	monday: 1,
	tuesday: 2,
	wednesday: 3,
	thursday: 4,
	friday: 5,
	saturday: 6,
};

const UNITS: Record<string, Unit> = {
	day: "day",
	days: "day",
	daily: "day",
	week: "week",
	weeks: "week",
	weekly: "week",
	month: "month",
	months: "month",
	monthly: "month",
	year: "year",
	years: "year",
	yearly: "year",
	annually: "year",
};

/**
 * Read a repeat rule, or null if it is not one we understand.
 *
 * Null matters: an unrecognised rule must leave the task alone rather than
 * guess. A task that repeats on the wrong schedule is worse than one that does
 * not repeat, because the first is silent and the second is obvious.
 */
export function parseRule(input: string): Rule | null {
	let text = input.trim().toLowerCase();
	if (!text) return null;

	const whenDone = /\bwhen\s+done\b/.test(text);
	text = text.replace(/\bwhen\s+done\b/, "").trim();

	// "every" is optional: both "every week" and "weekly" are in the wild.
	text = text.replace(/^every\s*/, "").trim();
	if (!text) return null;

	// "every other week"
	let every = 1;
	const other = text.match(/^other\s+(.*)$/);
	if (other) {
		every = 2;
		text = other[1].trim();
	} else {
		const n = text.match(/^(\d+)\s+(.*)$/);
		if (n) {
			every = parseInt(n[1], 10);
			text = n[2].trim();
			if (!Number.isFinite(every) || every < 1) return null;
		}
	}

	if (text in WEEKDAYS) {
		return { every, unit: "week", whenDone, weekday: WEEKDAYS[text] };
	}
	if (text in UNITS) {
		return { every, unit: UNITS[text], whenDone };
	}
	return null;
}

/**
 * The next occurrence after `from`, as `YYYY-MM-DD`.
 *
 * `from` is the date the next one is counted from: the task's own due date
 * normally, or the completion date when the rule says `when done`.
 */
export function nextDate(rule: Rule, from: string): string | null {
	const d = parseISO(from);
	if (!d) return null;

	if (rule.weekday !== undefined) {
		// The next matching weekday strictly after `from`, then any extra whole
		// weeks. "every monday" from a Monday means *next* Monday, not today.
		let delta = (rule.weekday - d.getUTCDay() + 7) % 7;
		if (delta === 0) delta = 7;
		d.setUTCDate(d.getUTCDate() + delta + (rule.every - 1) * 7);
		return toISO(d);
	}

	switch (rule.unit) {
		case "day":
			d.setUTCDate(d.getUTCDate() + rule.every);
			return toISO(d);
		case "week":
			d.setUTCDate(d.getUTCDate() + rule.every * 7);
			return toISO(d);
		case "month":
			return toISO(addMonths(d, rule.every));
		case "year":
			return toISO(addMonths(d, rule.every * 12));
	}
}

/**
 * Add whole months, clamping the day to the target month's length.
 *
 * This is the trap. Setting the month on 31 January and asking for February
 * gives 3 March, because the day overflows into the next month — so "every
 * month" on the 31st would walk forward through the calendar a few days at a
 * time. Clamping gives 28 February (or the 29th in a leap year), which is what
 * a person means by "the same date next month".
 */
function addMonths(d: Date, months: number): Date {
	const day = d.getUTCDate();
	const target = new Date(d.getTime());
	target.setUTCDate(1);
	target.setUTCMonth(target.getUTCMonth() + months);
	const last = daysInMonth(target.getUTCFullYear(), target.getUTCMonth());
	target.setUTCDate(Math.min(day, last));
	return target;
}

function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Strict `YYYY-MM-DD`. Rejects impossible dates rather than rolling them over. */
export function parseISO(value: string): Date | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
	if (!m) return null;
	const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
	if (mo < 1 || mo > 12 || da < 1) return null;
	if (da > daysInMonth(y, mo - 1)) return null;
	return new Date(Date.UTC(y, mo - 1, da));
}

function toISO(d: Date): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * The dates the next instance of a repeating task should carry.
 *
 * A task can have a due date, a scheduled date, or both, and both have to move
 * together — a task scheduled two days before it is due must stay scheduled two
 * days before it is due. So the rule is applied to whichever date anchors the
 * task, and the other one shifts by the same number of days.
 *
 * Returns null when there is nothing to advance: no rule, or no date to count
 * from and no completion date either.
 */
export function nextOccurrence(
	repeat: string,
	dates: { due?: string; scheduled?: string },
	completedOn: string
): { due?: string; scheduled?: string } | null {
	const rule = parseRule(repeat);
	if (!rule) return null;

	// The anchor is what the rule counts from. `when done` says to count from
	// today regardless; otherwise the task's own dates are the schedule and the
	// completion date is only a fallback for a task that had neither.
	const anchorField: "due" | "scheduled" | null = dates.due
		? "due"
		: dates.scheduled
			? "scheduled"
			: null;
	const anchorDate = rule.whenDone
		? completedOn
		: anchorField
			? (dates[anchorField] as string)
			: completedOn;

	const next = nextDate(rule, anchorDate);
	if (!next) return null;

	// With only one date, or none, there is no gap to preserve.
	if (!anchorField) return { due: next };
	if (!dates.due || !dates.scheduled) {
		return anchorField === "due" ? { due: next } : { scheduled: next };
	}

	const shift = daysBetween(dates[anchorField] as string, next);
	if (shift === null) return null;
	const other = anchorField === "due" ? "scheduled" : "due";
	const moved = shiftDays(dates[other] as string, shift);
	if (!moved) return null;

	return anchorField === "due"
		? { due: next, scheduled: moved }
		: { scheduled: next, due: moved };
}

function daysBetween(a: string, b: string): number | null {
	const x = parseISO(a);
	const y = parseISO(b);
	if (!x || !y) return null;
	return Math.round((y.getTime() - x.getTime()) / 86400000);
}

function shiftDays(value: string, days: number): string | null {
	const d = parseISO(value);
	if (!d) return null;
	d.setUTCDate(d.getUTCDate() + days);
	return toISO(d);
}
