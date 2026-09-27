/**
 * The grace period a ticked task gets before its row goes.
 *
 * Completing a task writes the file at once, and the write comes back as a vault
 * event that repaints the pane — so the row that was clicked is gone within about
 * 30ms and there is nothing left to animate. What this guards is the arrangement
 * that gives it back: a done task inside its window is drawn in the open list,
 * marked, with its animation offset by however long it has already been leaving.
 *
 * That last part is the whole trick and the reason this is a rendered test rather
 * than a readable one. The pane is replaced wholesale on every repaint, so a CSS
 * animation on a class restarts each time — once a second if anything else in the
 * vault is moving. A negative `animation-delay` equal to the elapsed time makes
 * it resume instead, and nothing but a real browser will tell you whether it did.
 */
import { launch } from "./browser.mjs";

const url = "file://" + process.cwd() + "/harness/index.html";
const browser = await launch();

const results = [];
const check = (name, pass, detail = "") => {
	results.push({ name, pass, detail });
	console.log(`${pass ? "  ok  " : "  FAIL"} ${name}${detail ? "  — " + detail : ""}`);
};

const PANE = "#drag";
const DONE = "Draft the outline";

/**
 * What the pane says about a task, without needing the completed section open.
 *
 * The section is collapsed by default, so its rows are not in the DOM at all —
 * only its count is. That count is the assertion: a held task is one the
 * completed section has not been given yet.
 */
async function split(page, pane = PANE) {
	return page.evaluate((p) => {
		const root = document.querySelector(p);
		const rows = Array.from(root.querySelectorAll(".lv-task"));
		const completed = root.querySelector(".lv-completed");
		return {
			open: rows.map((r) => r.querySelector(".lv-task-title")?.textContent?.trim() ?? ""),
			completedCount: Number(
				completed?.querySelector(".lv-section-count")?.textContent ?? "0"
			),
			leaving: rows
				.filter((r) => r.classList.contains("is-leaving"))
				.map((r) => r.querySelector(".lv-task-title")?.textContent?.trim() ?? ""),
		};
	}, pane);
}

const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForTimeout(200);

/* ------------------------------------------------------------------
   1. Untouched, a completed task is in the completed section
   ------------------------------------------------------------------ */

await page.evaluate(() => window.lvClearLeaving());
let s = await split(page);
const baseline = s.completedCount;
check("a completed task starts in the completed section", baseline > 0, `count ${baseline}`);
check("and not in the open list", !s.open.includes(DONE), JSON.stringify(s.open));
check("nothing is leaving", s.leaving.length === 0, JSON.stringify(s.leaving));

/* ------------------------------------------------------------------
   2. Inside its window it is held in the open list instead
   ------------------------------------------------------------------ */

await page.evaluate((t) => window.lvSetLeaving(t, 0), DONE);
s = await split(page);
check("a task just ticked is held in the open list", s.open.includes(DONE), JSON.stringify(s.open));
check(
	"and the completed section has one fewer",
	s.completedCount === baseline - 1,
	`${s.completedCount} vs ${baseline}`
);
check("and is marked as leaving", s.leaving.includes(DONE), JSON.stringify(s.leaving));

/* ------------------------------------------------------------------
   3. It is crossed out while it waits
   ------------------------------------------------------------------ */

const struck = await page.evaluate(
	(pane) => {
		const row = Array.from(document.querySelectorAll(`${pane} .lv-task`)).find((r) =>
			r.classList.contains("is-leaving")
		);
		if (!row) return null;
		const title = row.querySelector(".lv-task-title");
		return getComputedStyle(title).textDecorationLine;
	},
	PANE
);
check("the held row is struck through", !!struck && struck.includes("line-through"), String(struck));

/* ------------------------------------------------------------------
   4. The animation resumes across a repaint rather than restarting
   ------------------------------------------------------------------ */

/*
 * The fade's delay, in milliseconds. It counts *down* from the linger: a row just
 * ticked waits 1600ms before fading, one ticked 900ms ago waits 700. The row is
 * carrying two animations now, so the first of the two is the one to read.
 */
const delayAt = (pane) =>
	page.evaluate((p) => {
		const row = Array.from(document.querySelectorAll(`${p} .lv-task`)).find((r) =>
			r.classList.contains("is-leaving")
		);
		if (!row) return null;
		const first = getComputedStyle(row).animationDelay.split(",")[0].trim();
		return Math.round(parseFloat(first) * 1000);
	}, pane);

await page.evaluate((t) => window.lvSetLeaving(t, 0), DONE);
const fresh = await delayAt(PANE);
// Full linger still to wait, less the few milliseconds the machine took.
check(
	"a freshly ticked row has its whole wait ahead of it",
	fresh <= 1600 && fresh > 1200,
	`${fresh}ms (wanted about 1600)`
);

await page.evaluate((t) => window.lvSetLeaving(t, 900), DONE);
const aged = await delayAt(PANE);
check(
	"a row repainted part way through resumes where it was",
	aged <= 700 && aged > 100,
	`${aged}ms (wanted about 700 — the linger less the 900 already spent)`
);

// Repainting again must not move it back to the start.
await page.evaluate(() => window.paint());
const repainted = await delayAt(PANE);
/*
 * The wait may only ever shrink. Comparing two readings for closeness measured
 * how quick the machine was rather than what the code did — more real time
 * passes between them on a slow runner, which is the countdown working. A
 * restart is what this guards, and a restart reads as the whole linger again.
 */
check(
	"and a further repaint does not restart it",
	repainted <= aged + 5 && repainted < 1000,
	`${repainted}ms after ${aged}ms`
);

/* ------------------------------------------------------------------
   4b. The window only ever holds a task that is actually done

   Completing a repeating task inserts the next occurrence above it, so a
   key can end up pointing at a line that has become a *new, unfinished*
   task. Crossing that one out and fading it away would be the worst kind
   of bug: the row you just created vanishing in front of you.
   ------------------------------------------------------------------ */

await page.evaluate(() => window.lvSetLeaving("Chase the design review", 0));
const wrong = await split(page);
check(
	"an unfinished task is never held, whatever the map says",
	wrong.leaving.length === 0,
	JSON.stringify(wrong.leaving)
);
check(
	"and it stays in the open list as normal",
	wrong.open.includes("Chase the design review"),
	JSON.stringify(wrong.open)
);

/* ------------------------------------------------------------------
   5. Past its window it lets go
   ------------------------------------------------------------------ */

await page.evaluate((t) => window.lvSetLeaving(t, 5000), DONE);
s = await split(page);
check(
	"a task past its window returns to the completed section",
	s.completedCount === baseline,
	`${s.completedCount} vs ${baseline}`
);
check("and is out of the open list", !s.open.includes(DONE), JSON.stringify(s.open));

/* ------------------------------------------------------------------
   6. Reduced motion keeps the grace period, drops the motion
   ------------------------------------------------------------------ */

const still = await browser.newPage({
	viewport: { width: 1180, height: 900 },
	reducedMotion: "reduce",
});
await still.goto(url);
await still.waitForTimeout(200);
await still.evaluate((t) => window.lvSetLeaving(t, 0), DONE);

const calm = await still.evaluate(
	(pane) => {
		const row = Array.from(document.querySelectorAll(`${pane} .lv-task`)).find((r) =>
			r.classList.contains("is-leaving")
		);
		if (!row) return null;
		const cs = getComputedStyle(row);
		return { name: cs.animationName, held: true };
	},
	PANE
);
check("reduced motion still holds the row", !!calm && calm.held, JSON.stringify(calm));
check("but runs no animation on it", !!calm && calm.name === "none", JSON.stringify(calm));

/* ------------------------------------------------------------------
   7. Starring holds the row down before it travels

   With the starred band on, starring lifts a task out of its group to the
   top of the list. Held back for half a second, the star is seen to light
   where it was pressed and a mistaken one can be taken back before the row
   has gone anywhere. The slide then carries it, which the anchor suite
   covers separately.
   ------------------------------------------------------------------ */

const STARRED = "Write update to Microsoft To Do review";

/** Whether the starred task is up in the band, for a given hold age. */
async function banded(ageMs) {
	return page.evaluate(
		({ title, ageMs, pane }) => {
			if (ageMs === null) window.lvClearLifting();
			else window.lvSetLifting(title, ageMs);
			const root = document.querySelector(pane);
			const band = root.querySelector(".lv-starred-run");
			const inBand = Array.from(band?.querySelectorAll(".lv-task-title") ?? []).map((e) =>
				e.textContent.trim()
			);
			return { hasBand: !!band, inBand };
		},
		{ title: STARRED, ageMs, pane: PANE }
	);
}

let b = await banded(null);
check("a starred task sits in the band when nothing holds it", b.inBand.includes(STARRED), JSON.stringify(b.inBand));

b = await banded(0);
check(
	"a task just starred is held down out of the band",
	!b.inBand.includes(STARRED),
	JSON.stringify(b.inBand)
);
check(
	"and with nothing left starred the band is not drawn at all",
	!b.hasBand,
	`band present: ${b.hasBand}`
);

b = await banded(5000);
check(
	"once the hold is up it takes its place in the band",
	b.inBand.includes(STARRED),
	JSON.stringify(b.inBand)
);

/* ------------------------------------------------------------------
   8. The gap actually closes

   The row's box has to reach nothing by the end of the window, or removing
   it from the list snaps the rows below upward by whatever is left — which
   is the jump the fade was supposed to replace. `min-height` is the trap:
   it beats `max-height` in CSS, so a collapse that animates only max-height
   stops dead at the row's floor. On a phone that floor is most of the row.
   ------------------------------------------------------------------ */

/** The row's rendered height at a given point in its window. */
async function heightAt(target, ageMs) {
	return target.evaluate(
		({ title, ageMs, pane }) => {
			window.lvSetLeaving(title, ageMs);
			const row = Array.from(document.querySelectorAll(`${pane} .lv-task`)).find((r) =>
				r.classList.contains("is-leaving")
			);
			return row ? Math.round(row.getBoundingClientRect().height) : null;
		},
		{ title: DONE, ageMs, pane: PANE }
	);
}

const full = await heightAt(page, 0);
const closing = await heightAt(page, 1990);
check(
	"the row still has its full height while it waits",
	full !== null && full > 20,
	`${full}px`
);
check(
	"and has closed to nothing by the end of the window",
	closing !== null && closing < 8,
	`${closing}px at 1990ms of 2000 (was ${full}px)`
);

/*
 * And it must hold that height for the whole wait, not creep downward.
 *
 * A property named only in the last keyframe interpolates from its base value
 * across the entire animation, not across the segment it appears in — so a
 * padding zeroed at 100% starts shrinking at 0%. The row squeezed slowly for a
 * second and a half on a desktop, and on a phone, where the content height
 * dominates, it did not show at all. The two form factors have to match.
 */
const midLinger = await heightAt(page, 800);
const lateLinger = await heightAt(page, 1600);
check(
	"the row does not creep downward while it waits",
	Math.abs(midLinger - full) <= 1 && Math.abs(lateLinger - full) <= 1,
	`${full}px at 0ms, ${midLinger}px at 800ms, ${lateLinger}px at 1600ms`
);

/*
 * And on a phone, where the row's floor is most of its height — the case that
 * turns a fade into a jump.
 */
const phone = await browser.newPage({ viewport: { width: 390, height: 780 } });
await phone.goto(url);
await phone.waitForTimeout(200);
await phone.evaluate(() => document.body.classList.add("is-phone", "is-mobile"));
await phone.waitForTimeout(100);
const phoneFull = await heightAt(phone, 0);
const phoneClosing = await heightAt(phone, 1990);
check(
	"a phone row closes too, floor and all",
	phoneClosing !== null && phoneClosing < 8,
	`${phoneClosing}px at 1990ms (was ${phoneFull}px)`
);

/* ------------------------------------------------------------------ */

check("no page errors", errors.length === 0, errors.join(" | "));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
