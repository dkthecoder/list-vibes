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
import { launch } from "./browser.mjs";

const url = "file://" + process.cwd() + "/harness/index.html";
const browser = await launch();

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
   4. The detail panel's dividers

   The leading and text columns moved to `columns.mjs`, which measures
   centres rather than left edges — the rule that holds once a 16px
   checkbox and a 24px icon share a slot. What stays here is the divider,
   which belongs to the row it separates.
   ------------------------------------------------------------------ */

const DETAIL = "#picker .lv-detail";

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

/* ------------------------------------------------------------------
   Alignment: one column down each edge of the list

   The checkbox, the title's first line and the star are three things
   that read as a column, so any disagreement between them shows. Two
   were found by eye on a tablet: the star sat six pixels low, because a
   32px tap target top-aligned against a 20px line does, and the
   completed rows were inset four pixels further than the open ones,
   because the group and the completed section carried different
   paddings.
   ------------------------------------------------------------------ */

/*
 * The completed section starts collapsed, and collapsed is exactly where the
 * misalignment hid: half the rows in the list were never on screen to be
 * compared with the other half. So it is opened first, by clicking the header
 * the user clicks rather than by reaching into state.
 */
await page.click(`${PANE} .lv-completed-head`);
await page.waitForTimeout(120);

const columns = await page.evaluate((pane) => {
	const frame = document.querySelector(pane);
	const mid = (el) => {
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	};
	const row = (r) => {
		const box = r.querySelector(".lv-check, input[type=checkbox]");
		const title = r.querySelector(".lv-task-title");
		const star = r.querySelector(".lv-star");
		if (!box || !title || !star) return null;
		// The first line of the title, not the whole (possibly wrapped) block.
		const line = title.getClientRects()[0];
		return {
			box: mid(box),
			star: mid(star),
			line: Math.round(line.top + line.height / 2),
			left: Math.round(r.getBoundingClientRect().left),
			right: Math.round(r.getBoundingClientRect().right),
		};
	};
	const open = [...frame.querySelectorAll(".lv-group .lv-task")].map(row).filter(Boolean);
	const done = [...frame.querySelectorAll(".lv-completed .lv-task")].map(row).filter(Boolean);
	return { open, done };
}, PANE);

const all = [...columns.open, ...columns.done];
check(
	"there are rows on both sides of the divide to compare",
	columns.open.length > 0 && columns.done.length > 0,
	`${columns.open.length} open, ${columns.done.length} completed`
);

const offBox = all.filter((r) => Math.abs(r.box.y - r.line) > 2);
check(
	"every checkbox is centred on its title's first line",
	offBox.length === 0,
	offBox.map((r) => `box ${r.box.y} vs line ${r.line}`).join(", ")
);

const offStar = all.filter((r) => Math.abs(r.star.y - r.line) > 2);
check(
	"and so is every star",
	offStar.length === 0,
	offStar.map((r) => `star ${r.star.y} vs line ${r.line}`).join(", ")
);

const boxX = new Set(all.map((r) => r.box.x));
const starX = new Set(all.map((r) => r.star.x));
check(
	"the checkboxes share one column, completed rows included",
	boxX.size === 1,
	`x positions: ${[...boxX].join(", ")}`
);
check(
	"and so do the stars",
	starX.size === 1,
	`x positions: ${[...starX].join(", ")}`
);

/* ------------------------------------------------------------------
   Corners: rounded, not lozenges
   ------------------------------------------------------------------ */

const corners = await page.evaluate((pane) => {
	const frame = document.querySelector(pane);
	// A theme that draws its nav items as pills, which is where this came from.
	frame.querySelector(".lv-root").style.setProperty("--radius-m", "999px");
	frame.querySelector(".lv-root").style.setProperty("--radius-s", "999px");
	frame.querySelector(".lv-root").style.setProperty("--nav-item-radius", "999px");
	const read = (sel) => {
		const el = frame.querySelector(sel);
		return el ? Math.round(parseFloat(getComputedStyle(el).borderTopLeftRadius)) : -1;
	};
	return { row: read(".lv-task"), head: read(".lv-completed-head"), add: read(".lv-add-input") };
}, PANE);

for (const [what, r] of Object.entries(corners)) {
	if (r < 0) continue;
	check(
		`the ${what} keeps a corner radius, not a pill`,
		r <= 10,
		`border-radius=${r}px against a theme asking for 999px`
	);
}

/* ------------------------------------------------------------------
   Fields that are as tall as what is in them

   The note box was rows="3" and the step box a fixed-height <input>:
   an empty note reserved three lines of nothing, a long one was
   squeezed into three with a scrollbar inside it, and a step longer
   than the field scrolled sideways so you could not read what you had
   typed. Tolerable in an overlay two thirds of a tablet wide; not in a
   300px sidebar, which is what the panel is now.
   ------------------------------------------------------------------ */

const grow = await page.evaluate(async (pane) => {
	const frame = document.querySelector(pane);
	// The width the panel actually opens at, not the width the overlay had.
	frame.closest(".frame")?.style.setProperty("width", "300px");
    const sleep = () => new Promise((r) => requestAnimationFrame(() => r()));
	await sleep();

	const measure = async (sel, text) => {
		const el = frame.querySelector(sel);
		if (!el) return null;
		const before = Math.round(el.getBoundingClientRect().height);
		el.value = text;
		el.dispatchEvent(new Event("input", { bubbles: true }));
		await sleep();
		const after = Math.round(el.getBoundingClientRect().height);
		const scrolls = getComputedStyle(el).overflowY;
		el.value = "";
		el.dispatchEvent(new Event("input", { bubbles: true }));
		await sleep();
		const back = Math.round(el.getBoundingClientRect().height);
		return { before, after, back, scrolls, wraps: getComputedStyle(el).whiteSpace };
	};

	const long = "A step title long enough that it cannot possibly fit on one line in a panel this narrow, and then some more.";
	const veryLong = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");

	return {
		note: await measure(".lv-note-input", long),
		step: await measure(".lv-step-input", long),
		capped: await measure(".lv-note-input", veryLong),
	};
}, DETAIL);

for (const [what, m] of Object.entries(grow)) {
	if (!m) continue;
	if (what === "capped") continue;
	check(
		`the ${what} field grows to fit what is typed`,
		m.after > m.before,
		`${m.before}px -> ${m.after}px at 300px wide`
	);
	check(
		`and the ${what} field shrinks back when it is emptied`,
		m.back === m.before,
		`${m.after}px -> ${m.back}px, resting ${m.before}px`
	);
	check(
		`and the ${what} field does not scroll while it fits`,
		m.scrolls === "hidden",
		`overflow-y=${m.scrolls}`
	);
}

check(
	"but past its ceiling it scrolls rather than growing without end",
	grow.capped && grow.capped.scrolls === "auto",
	`overflow-y=${grow.capped?.scrolls} at ${grow.capped?.after}px`
);
check(
	"and the ceiling is a fraction of the panel, not the whole of it",
	grow.capped && grow.capped.after < 1000,
	`${grow.capped?.after}px`
);

/* ------------------------------------------------------------------
   5. Alternate rows are shaded, and hover still shows

   The stripe borrows `--lv-surface-alt`, the pane's own opposite. The
   trap is picking a colour the row already uses for something else: a
   stripe in the hover colour makes every other row look permanently
   hovered, and hovering it does nothing.
   ------------------------------------------------------------------ */

/* ---------------- a row is a box ---------------- */

/* Stripes are gone. They separated one row from the next by tinting every other
   one, which needed a rule about odd and even that broke the moment a section
   split the list, and gave the rows nothing in common with the wall. A row now
   carries the card's own surface instead. */
const boxes = await page.evaluate((pane) => {
	const rows = Array.from(document.querySelectorAll(`${pane} .lv-group .lv-task`));
	const pane_ = document.querySelector(`${pane} .lv-scroll`) ?? document.querySelector(pane);
	const s = (el) => getComputedStyle(el);
	return {
		count: rows.length,
		stripedAny: rows.some((r) => r.classList.contains("lv-stripe")),
		colours: [...new Set(rows.map((r) => s(r).backgroundColor))],
		pane: s(pane_).backgroundColor,
		radius: rows[0] ? s(rows[0]).borderTopLeftRadius : "0px",
		gap: rows[0] ? s(rows[0]).marginBottom : "0px",
	};
}, PANE);

check("no row is striped any more", !boxes.stripedAny);

check(
	"every row has the same resting surface",
	boxes.count > 2 && boxes.colours.length === 1,
	JSON.stringify(boxes.colours)
);

check(
	"which is distinguishable from the pane behind it",
	boxes.colours[0] !== boxes.pane,
	`row=${boxes.colours[0]} pane=${boxes.pane}`
);

check("a row is rounded", parseFloat(boxes.radius) > 0, boxes.radius);
check("and separated from the next", parseFloat(boxes.gap) > 0, boxes.gap);

// `:hover` needs a real pointer, so this is Playwright moving one rather than a
// dispatched event, which would not match the selector.
const rowSel = `${PANE} .lv-group .lv-task`;
const colourOf = (sel) =>
	page.evaluate((x) => getComputedStyle(document.querySelector(x)).backgroundColor, sel);

const resting = await colourOf(rowSel);
await page.hover(rowSel);
const hovered = await colourOf(rowSel);

check(
	"and still answers the pointer",
	resting !== hovered,
	`resting=${resting} hovered=${hovered}`
);

/* A subtask is not a row of its own: the pane iterates root tasks and a child
   shows as a "1 of 3" count inside the parent. Were a child ever rendered as
   its own row it would draw its own box inside its parent's. */
const nesting = await page.evaluate((pane) => {
	const rows = Array.from(document.querySelectorAll(`${pane} .lv-group .lv-task`));
	return {
		nested: rows.filter((r) => r.querySelector(".lv-task")).length,
		withChildren: rows.filter((r) => /\d+ of \d+/.test(r.textContent ?? "")).length,
	};
}, PANE);

check(
	"a task with subtasks is still one box, not a box inside a box",
	nesting.withChildren > 0 && nesting.nested === 0,
	`${nesting.withChildren} row(s) with subtasks, ${nesting.nested} nested`
);

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
