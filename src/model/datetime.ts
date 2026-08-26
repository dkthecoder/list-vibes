/**
 * A date that may carry a time.
 *
 * The Tasks emoji dialect stores a bare date — `✅ 2026-08-26` — which is fine
 * for a due date and thin for a completion: "Completed Today" tells you nothing
 * you did not already know, and by tomorrow it tells you less.
 *
 * So a stamp may be `2026-08-26` or `2026-08-26T14:32`, and everything that
 * reads one has to cope with either. The separator written is `T`, which keeps
 * the whole stamp a single whitespace-free token — the emoji dialect is parsed
 * by splitting on spaces, so a stamp with a space in it would be read as a date
 * followed by a stray word, in this parser and in every other tool that reads
 * these files. A space *is* accepted on the way in, because a person editing
 * the markdown by hand will write one.
 *
 * Existing bare dates keep working untouched, and nothing is rewritten that the
 * user has not just changed.
 */

/** `2026-08-26T14:32` -> `2026-08-26`. A bare date is returned unchanged. */
export function datePart(stamp?: string): string {
	if (!stamp) return "";
	return stamp.slice(0, 10);
}

/** `2026-08-26T14:32` -> `14:32`, and `2026-08-26` -> "". */
export function timePart(stamp?: string): string {
	if (!stamp || stamp.length < 16) return "";
	const time = stamp.slice(11, 16);
	return /^\d{2}:\d{2}$/.test(time) ? time : "";
}

/** True if the stamp carries a time as well as a date. */
export function hasTime(stamp?: string): boolean {
	return timePart(stamp) !== "";
}

/**
 * Normalise a stamp for writing: `T` between the two halves, seconds dropped.
 *
 * Seconds are dropped rather than kept because nothing here is precise to the
 * second — the stamp is written when a checkbox is ticked, and a to-do list
 * that reports `14:32:07` is claiming an accuracy it does not have.
 */
export function normalizeStamp(stamp?: string): string {
	if (!stamp) return "";
	const date = datePart(stamp);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return stamp;
	const rest = stamp.slice(10);
	const time = /^[T ](\d{2}:\d{2})/.exec(rest);
	return time ? `${date}T${time[1]}` : date;
}

/** Now, as `2026-08-26T14:32` or `2026-08-26` depending on `withTime`. */
export function stampNow(withTime: boolean, now: Date = new Date()): string {
	const p = (n: number) => String(n).padStart(2, "0");
	const date = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
	if (!withTime) return date;
	return `${date}T${p(now.getHours())}:${p(now.getMinutes())}`;
}
