/**
 * The note, previewed under the task's title.
 *
 * A note used to show as a chip reading "Note", which told you one existed and
 * nothing about whether it mattered. The reference screenshots show the note
 * itself: one faint line, cut off where the row runs out.
 *
 * The line has one hard requirement that is easy to lose by accident — it must
 * stay *one* line however long the note is, or a list of tasks with notes turns
 * into a wall of paragraphs. That is a rendered fact, not a readable one, so it
 * is measured here rather than asserted in a unit test.
 */
import { chromium } from "playwright";

const url = "file://" + process.cwd() + "/harness/index.html";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

const results = [];
const check = (name, pass, detail = "") => {
	results.push({ name, pass, detail });
	console.log(`${pass ? "  ok  " : "  FAIL"} ${name}${detail ? "  — " + detail : ""}`);
};

const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForTimeout(200);

const PANE = "#drag";

/* ------------------------------------------------------------------
   1. It is there, and only where there is a note
   ------------------------------------------------------------------ */

const rows = await page.evaluate((pane) => {
	return Array.from(document.querySelectorAll(`${pane} .lv-task`)).map((row) => ({
		title: row.querySelector(".lv-task-title")?.textContent?.trim() ?? "",
		note: row.querySelector(".lv-task-note")?.textContent?.trim() ?? null,
		meta: row.querySelector(".lv-task-meta")?.textContent ?? "",
	}));
}, PANE);

const withNote = rows.filter((r) => r.note !== null);
check("a task with a note shows it", withNote.length > 0, `${withNote.length} of ${rows.length} rows`);

check(
	"and it is the note's own words, not a label",
	withNote.every((r) => r.note && r.note.length > 0 && r.note !== "Note"),
	JSON.stringify(withNote.map((r) => r.note))
);

check(
	"the fixture's note reads through in full",
	withNote.some((r) => r.note === "Remember the product entry needs the new pricing table."),
	JSON.stringify(withNote.map((r) => r.note))
);

check(
	"a task without a note gets no empty line",
	rows.filter((r) => r.note === null).length > 0,
	`${rows.filter((r) => r.note === null).length} rows without`
);

check(
	'the old "Note" chip is gone from the metadata',
	rows.every((r) => !/\bNote\b/.test(r.meta)),
	JSON.stringify(rows.map((r) => r.meta).filter((m) => /Note/.test(m)))
);

/* ------------------------------------------------------------------
   2. One line, cut off — however long the note is
   ------------------------------------------------------------------ */

const NOTE = `${PANE} .lv-task-note`;

const oneLine = await page.$eval(NOTE, (e) => {
	const cs = getComputedStyle(e);
	return {
		height: Math.round(e.getBoundingClientRect().height),
		lineHeight: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3,
		whiteSpace: cs.whiteSpace,
		overflow: cs.overflow,
		textOverflow: cs.textOverflow,
	};
});
check(
	"it is a single line tall",
	oneLine.height <= Math.ceil(oneLine.lineHeight) + 1,
	`${oneLine.height}px against a line of ${oneLine.lineHeight}px`
);
check("it does not wrap", oneLine.whiteSpace === "nowrap", oneLine.whiteSpace);
check(
	"and it ends in an ellipsis rather than being clipped mid-letter",
	oneLine.textOverflow === "ellipsis",
	oneLine.textOverflow
);

// A note far longer than the row. The one-line rule has to survive this, which
// is the case that actually turns up — a note is where people put paragraphs.
const long = await page.$eval(NOTE, (e) => {
	e.textContent = "A very long note. ".repeat(40);
	const r = e.getBoundingClientRect();
	const row = e.closest(".lv-task").getBoundingClientRect();
	return {
		height: Math.round(r.height),
		overflowing: e.scrollWidth > e.clientWidth,
		right: Math.round(r.right),
		rowRight: Math.round(row.right),
	};
});
check(
	"a paragraph-length note is still one line",
	long.height <= Math.ceil(oneLine.lineHeight) + 1,
	`${long.height}px`
);
check("and is genuinely truncated", long.overflowing, `scrollWidth > clientWidth: ${long.overflowing}`);
check(
	"without pushing past the row it is in",
	long.right <= long.rowRight,
	`note right ${long.right}, row right ${long.rowRight}`
);

/* ------------------------------------------------------------------
   3. Faint, and beneath the title

   Three tiers of emphasis in one row — title, note, metadata — only work if
   they are actually distinguishable. The note being the same weight as the
   metadata would read as two subtitles rather than a quiet echo.
   ------------------------------------------------------------------ */

await page.reload();
await page.waitForTimeout(200);

const emphasis = await page.evaluate((pane) => {
	const row = document.querySelector(`${pane} .lv-task-note`).closest(".lv-task");
	const at = (sel) => {
		const el = row.querySelector(sel);
		if (!el) return null;
		const cs = getComputedStyle(el);
		return { colour: cs.color, size: cs.fontSize, top: Math.round(el.getBoundingClientRect().top) };
	};
	return { title: at(".lv-task-title"), note: at(".lv-task-note"), meta: at(".lv-task-meta") };
}, PANE);

check(
	"the note sits below the title",
	emphasis.note.top > emphasis.title.top,
	`title ${emphasis.title.top}, note ${emphasis.note.top}`
);
check(
	"and above the metadata",
	!emphasis.meta || emphasis.note.top < emphasis.meta.top,
	emphasis.meta ? `note ${emphasis.note.top}, meta ${emphasis.meta.top}` : "(no metadata on this row)"
);
check(
	"it is quieter than the title",
	emphasis.note.colour !== emphasis.title.colour,
	`${emphasis.title.colour} vs ${emphasis.note.colour}`
);
check(
	"and quieter than the metadata, rather than a second subtitle",
	!emphasis.meta || emphasis.note.colour !== emphasis.meta.colour,
	emphasis.meta ? `${emphasis.meta.colour} vs ${emphasis.note.colour}` : "(no metadata on this row)"
);

/* ------------------------------------------------------------------
   4. The detail panel's rows line up

   Reported as "the lines and that aren't adding up... disjointed". Each
   row in the panel used to be positioned by its own rule with its own
   padding and its own slot width, and they landed a few pixels apart —
   which is not something the eye can name but is exactly what that
   complaint is. A few pixels is also not something a screenshot settles,
   so it is measured.
   ------------------------------------------------------------------ */

const DETAIL = "#picker .lv-detail";

const lead = await page.evaluate((sel) => {
	const panel = document.querySelector(sel);
	if (!panel) return null;
	const at = (el) => (el ? Math.round(el.getBoundingClientRect().left) : null);
	return {
		title: at(panel.querySelector(".lv-detail-title .lv-check, .lv-detail-title input")),
		step: at(panel.querySelector(".lv-step .lv-check, .lv-step input")),
		stepAdd: at(panel.querySelector(".lv-step-add .lv-check, .lv-step-add .lv-add-icon")),
		actions: Array.from(panel.querySelectorAll(".lv-action-icon")).map((e) =>
			Math.round(e.getBoundingClientRect().left)
		),
	};
}, DETAIL);

check("the detail panel is on screen to measure", lead !== null, JSON.stringify(lead));

if (lead) {
	// Every action icon on one line — these are siblings in one card, so any
	// disagreement here is a rule contradicting itself.
	const spread = lead.actions.length
		? Math.max(...lead.actions) - Math.min(...lead.actions)
		: 0;
	check(
		"every action icon starts on the same vertical line",
		lead.actions.length > 1 && spread === 0,
		`${lead.actions.length} icons, spread ${spread}px`
	);

	// And the rows in the cards above it agree with them, within a pixel of
	// rounding. This is the one that was actually wrong.
	const all = [lead.title, lead.step, lead.stepAdd, ...lead.actions].filter(
		(n) => typeof n === "number"
	);
	const across = Math.max(...all) - Math.min(...all);
	check(
		"and the title, steps and actions all share it",
		all.length >= 3 && across <= 1,
		`title=${lead.title} step=${lead.step} stepAdd=${lead.stepAdd} actions=${JSON.stringify(lead.actions)} spread=${across}px`
	);
}

// The dividers between actions have to start where the text starts and stop at
// the row's own padding — as a full-width border they began left of the icon
// and ended flush with the card, lining up with neither.
const divider = await page.evaluate((sel) => {
	const rows = Array.from(document.querySelectorAll(`${sel} .lv-action`));
	if (rows.length < 2) return null;
	const second = rows[1];
	const before = getComputedStyle(second, "::before");
	const text = second.querySelector(".lv-action-text");
	const row = second.getBoundingClientRect();
	return {
		drawn: before.content !== "none",
		startsAt: before.insetInlineStart || before.left,
		textStart: text ? Math.round(text.getBoundingClientRect().left - row.left) : null,
	};
}, DETAIL);

if (divider) {
	check("a divider is drawn between actions", divider.drawn, JSON.stringify(divider));
	check(
		"and it starts where the row's text starts",
		divider.textStart !== null &&
			Math.abs(parseFloat(divider.startsAt) - divider.textStart) <= 1,
		`divider at ${divider.startsAt}, text at ${divider.textStart}px`
	);
}

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
