/**
 * One leading column, one text column, one trailing column.
 *
 * `.lv-detail` declares `--lv-lead` and `--lv-text-start` so every row in the
 * panel keys off the same numbers. Only the action icons ever used them: a
 * checkbox took its intrinsic width instead, so steps and titles sat eight
 * pixels left of the actions and the dividers — computed from `--lv-lead` —
 * lined up with one and not the other. The same split ran through the list
 * pane, where the add box used a different padding from the task rows.
 *
 * None of that is visible in a stylesheet, because it is the *difference*
 * between two declarations in different rules. It is a rendered fact, so it is
 * measured.
 */
import { launch } from "./browser.mjs";

const url = "file://" + process.cwd() + "/harness/index.html";
const browser = await launch();

const results = [];
const check = (name, pass, detail = "") => {
	results.push({ name, pass, detail });
	console.log(`${pass ? "  ok  " : "  FAIL"} ${name}${detail ? "  — " + detail : ""}`);
};

/** Columns agree when every reading rounds to the same pixel. */
const agree = (xs) => xs.length > 0 && Math.max(...xs) - Math.min(...xs) <= 0.5;
const spread = (xs) => `${xs.map((x) => Math.round(x * 10) / 10).join(", ")}`;

const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForTimeout(200);

/* ------------------------------------------------------------------
   The detail panel
   ------------------------------------------------------------------ */

const detail = await page.evaluate(() => {
	const pane = document.querySelector("#desktop");
	const left = pane.getBoundingClientRect().left;
	const mid = (el) => {
		const r = el.getBoundingClientRect();
		return r.left + r.width / 2 - left;
	};
	const start = (el) => el.getBoundingClientRect().left - left;
	const all = (sel) => Array.from(pane.querySelectorAll(sel));

	// A text input's text starts inside its border and padding.
	const textStart = (el) => {
		const cs = getComputedStyle(el);
		return start(el) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
	};

	return {
		leads: [
			...all(".lv-detail-title > .task-list-item-checkbox").map(mid),
			...all(".lv-step:not(.lv-step-add) > .task-list-item-checkbox").map(mid),
			...all(".lv-step-add > *:first-child").map(mid),
			...all(".lv-action-icon").map(mid),
		],
		texts: [
			...all(".lv-detail-title-text").map(start),
			...all(".lv-step-label").map(start),
			...all(".lv-action-text").map(start),
		],
		chevrons: all(".lv-action-chevron").map(start),
		chevronRows: all(".lv-action").map((r) => ({
			label: r.querySelector(".lv-action-label")?.textContent ?? "",
			chevron: r.querySelector(".lv-action-chevron")
				? start(r.querySelector(".lv-action-chevron"))
				: null,
			hasClear: !!r.querySelector(".lv-action-clear:not(.is-empty)"),
		})),
		// The rendered view is what is on screen at rest; the textarea is
		// display:none until clicked and measures as nothing.
		noteText: all(".lv-note-read").map(textStart),
		// Both halves of the description must share one left inset, or the text
		// jumps sideways the moment the field is clicked into. Computed padding
		// rather than geometry, because one of the two is always hidden.
		noteInset: [".lv-note-read", ".lv-note-input"].map((sel) => {
			const el = document.querySelector(sel);
			if (!el) return null;
			const cs = getComputedStyle(el);
			return Math.round(
				parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft)
			);
		}),
		leadStart: all(".lv-step:not(.lv-step-add)").map(
			(row) => start(row) + parseFloat(getComputedStyle(row).paddingLeft)
		),
	};
});

check("the detail panel's leading slots share one centre", agree(detail.leads), spread(detail.leads));
check("and every row's text starts on one column", agree(detail.texts), spread(detail.texts));
check(
	"the chevrons hold their column whether or not a row can be cleared",
	agree(detail.chevrons),
	detail.chevronRows
		.filter((r) => r.chevron !== null)
		.map((r) => `${r.label}${r.hasClear ? "" : " (no clear)"}=${Math.round(r.chevron)}`)
		.join(", ")
);
check(
	"the note's left edge sits on the column the leading slots start from",
	detail.noteText.length > 0 &&
		detail.leadStart.length > 0 &&
		agree([detail.noteText[0], detail.leadStart[0]]),
	`note=${spread(detail.noteText)} slots=${spread(detail.leadStart)}`
);

check(
	"and the description's two views share one left inset, so the text does not move",
	detail.noteInset.every((v) => v !== null) &&
		new Set(detail.noteInset).size === 1,
	`read=${detail.noteInset[0]} input=${detail.noteInset[1]}`
);

/* ------------------------------------------------------------------
   The list pane
   ------------------------------------------------------------------ */

const list = await page.evaluate(() => {
	const pane = document.querySelector("#drag");
	const left = pane.getBoundingClientRect().left;
	const mid = (el) => {
		const r = el.getBoundingClientRect();
		return r.left + r.width / 2 - left;
	};
	const start = (el) => el.getBoundingClientRect().left - left;
	const textStart = (el) => {
		const cs = getComputedStyle(el);
		return start(el) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
	};
	const one = (sel) => pane.querySelector(sel);

	return {
		taskTitle: start(one(".lv-task .lv-task-title")),
		addText: textStart(one(".lv-add-input")),
		taskCheck: mid(one(".lv-task > .task-list-item-checkbox")),
		addIcon: mid(one(".lv-add-icon")),
	};
});

check(
	"the add box's text shares the task title column",
	agree([list.taskTitle, list.addText]),
	`title=${Math.round(list.taskTitle)} add=${Math.round(list.addText)}`
);
check(
	"and its + shares the checkbox centre",
	agree([list.taskCheck, list.addIcon]),
	`checkbox=${Math.round(list.taskCheck)} plus=${Math.round(list.addIcon)}`
);

/* ------------------------------------------------------------------
   The post-it card

   A card is a pinboard note, not a task with children showing. Keep draws
   its checklist items at the note's own left edge, so a card whose items
   are indented under its title is claiming a hierarchy this view does not
   have.
   ------------------------------------------------------------------ */

const card = await page.evaluate(() => {
	const pane = document.querySelector("#cards");
	const withItems = Array.from(pane.querySelectorAll(".lv-card-task")).find((c) =>
		c.querySelector(".lv-card-step")
	);
	if (!withItems) return null;
	const left = withItems.getBoundingClientRect().left;
	const mid = (el) => {
		const r = el.getBoundingClientRect();
		return r.left + r.width / 2 - left;
	};
	const start = (el) => el.getBoundingClientRect().left - left;
	return {
		boxes: [
			mid(withItems.querySelector(".lv-card-head > .task-list-item-checkbox")),
			...Array.from(withItems.querySelectorAll(".lv-card-step > .task-list-item-checkbox")).map(mid),
		],
		texts: [
			start(withItems.querySelector(".lv-card-title")),
			...Array.from(withItems.querySelectorAll(".lv-card-step-label")).map(start),
		],
	};
});

check("a post-it card with items is on screen to measure", card !== null);

if (card) {
	check(
		"the card's tickboxes all share one centre, title included",
		agree(card.boxes),
		spread(card.boxes)
	);
	check(
		"and every label starts on one column, so nothing is indented under anything",
		agree(card.texts),
		spread(card.texts)
	);
}

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
