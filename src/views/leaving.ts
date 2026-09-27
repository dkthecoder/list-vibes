/**
 * The grace period a completed task gets before it leaves the list.
 *
 * Ticking writes the file immediately — the file being the truth is the whole
 * point of this plugin, and a tick held back in memory for two seconds is a tick
 * that a crash or a sync loses. What waits is only the *row*: it stays where it
 * is, crossed out, for long enough that a mistaken tick can be taken back
 * without hunting through the completed section for it.
 *
 * Timing only. The row keeps its place because the tasks pane asks here whether
 * a done task is still inside its window, and the animation reads its age.
 */

/** How long the crossed-out row holds still, before it starts to go. */
export const LINGER_MS = 1600;
/** Fade and collapse, once the linger is up. */
export const FADE_MS = 400;
/** The whole window, from tick to gone. */
export const LEAVE_MS = LINGER_MS + FADE_MS;

/**
 * How long a newly starred row keeps its place before being lifted into the band.
 *
 * Much shorter than a tick's, because it is doing less. A tick has to stay
 * undoable after the row has been struck through and is on its way out of the
 * list; a star only has to be seen to light up where it was pressed, and leave
 * long enough to take back before the row travels.
 */
export const LIFT_MS = 500;

export type LeavingMap = Map<string, number>;

/**
 * A task's identity for this purpose.
 *
 * Split on the *last* colon when reading it back, so a list whose name contains
 * one — `9:30 standup.md` — does not parse as a different file.
 */
export function leavingKey(filePath: string, line: number): string {
	return `${filePath}:${line}`;
}

export function markLeaving(map: LeavingMap, key: string, now: number): void {
	map.set(key, now);
}

export function clearLeaving(map: LeavingMap, key: string): void {
	map.delete(key);
}

export function isLeaving(
	map: LeavingMap,
	key: string,
	now: number,
	windowMs = LEAVE_MS
): boolean {
	const at = map.get(key);
	return at !== undefined && now - at < windowMs;
}

/** Milliseconds since the tick, for an animation that has to survive a repaint. */
export function leavingAge(map: LeavingMap, key: string, now: number): number | null {
	const at = map.get(key);
	return at === undefined ? null : now - at;
}

/**
 * Drop what has run out, and say whether anything did — a caller repaints if so.
 *
 * The window is a parameter because the two holds are different lengths: a tick's
 * runs to `LEAVE_MS`, a star's to `LIFT_MS`.
 */
export function pruneLeaving(map: LeavingMap, now: number, windowMs = LEAVE_MS): boolean {
	let went = false;
	for (const [key, at] of map) {
		if (now - at >= windowMs) {
			map.delete(key);
			went = true;
		}
	}
	return went;
}

/**
 * Follow rows that moved when lines were inserted or removed above them.
 *
 * Completing a repeating task puts the next occurrence in above the one just
 * finished, so every line from there down shifts by one. Without this the key
 * points at a line that has become a different task, and the wrong row lingers
 * while the right one vanishes.
 */
export function shiftLeaving(
	map: LeavingMap,
	filePath: string,
	fromLine: number,
	by: number
): void {
	const moved: [string, string, number][] = [];
	for (const [key, at] of map) {
		const cut = key.lastIndexOf(":");
		if (cut < 0 || key.slice(0, cut) !== filePath) continue;
		const line = Number(key.slice(cut + 1));
		if (!Number.isFinite(line) || line < fromLine) continue;
		moved.push([key, leavingKey(filePath, line + by), at]);
	}
	for (const [from, to, at] of moved) {
		map.delete(from);
		map.set(to, at);
	}
}

/**
 * Put a row into its leaving state, resumed to wherever the window has got to.
 *
 * The negative `animation-delay` is the load-bearing part. A scoped repaint
 * replaces the whole pane, so a row carrying an animation is a *new* element
 * every time and its animation starts from zero — which, with anything else in
 * the vault changing, means a row that never gets past the first frame. A delay
 * of minus the elapsed time starts it already that far in.
 *
 * The duration is set here rather than in the stylesheet so the constants above
 * stay the only place the timing is written down. The keyframes still hold the
 * *split* between lingering and going, as percentages of it.
 */
export function applyLeaving(
	row: HTMLElement,
	map: LeavingMap,
	key: string,
	now: number
): void {
	const age = leavingAge(map, key, now);
	if (age === null || age >= LEAVE_MS) return;
	row.addClass("is-leaving");
	row.style.animationDuration = `${LEAVE_MS}ms`;
	row.style.animationDelay = `-${age}ms`;
	// The height to close from. Measured rather than guessed because a row with a
	// note preview is twice the height of one without, and a collapse that starts
	// from the wrong number either clips the row or pauses before it moves.
	const h = row.offsetHeight;
	if (h > 0) row.style.setProperty("--lv-leave-h", `${h}px`);
}
