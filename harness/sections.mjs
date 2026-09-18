/**
 * Sections, driven in a real browser.
 *
 * The unit tests cover what each section edit writes to the file. What they
 * cannot cover is the part that only exists as event handling: whether a
 * heading folds when clicked, whether an empty section is on screen to be
 * dropped into at all, and whether a card dragged across a heading asks for the
 * cross-section move rather than a plain reorder.
 */
import { launch } from "./browser.mjs";

const url = "file://" + process.cwd() + "/harness/index.html";
const browser = await launch();

const results = [];
const check = (name, pass, detail = "") => {
	results.push({ name, pass, detail });
	console.log(`${pass ? "  ok  " : "  FAIL"} ${name}${detail ? "  — " + detail : ""}`);
};

const PANE = "#sections";
const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForTimeout(250);

/* ---------------- the heading is a control ---------------- */

const heads = await page.$$(`${PANE} .lv-section`);
check("every heading is drawn", heads.length >= 4, `${heads.length} sections`);

const parts = await page.evaluate((sel) => {
	const h = document.querySelector(`${sel} .lv-section`);
	return {
		chevron: !!h?.querySelector(".lv-section-chevron svg"),
		name: h?.querySelector(".lv-section-name")?.textContent ?? "",
		count: h?.querySelector(".lv-section-count")?.textContent ?? "",
		more: !!h?.querySelector(".lv-section-more"),
		expanded: h?.getAttribute("aria-expanded"),
	};
}, PANE);

check("it has a fold control", parts.chevron);
check("it names the section", parts.name.length > 0, parts.name);
check("it counts what is in it", /^\d+$/.test(parts.count), parts.count);
check("it offers a menu", parts.more);
check("it reports its state to a screen reader", parts.expanded === "true");

/* ---------------- the row does not repeat its heading ---------------- */

const repeats = await page.evaluate((sel) => {
	const rows = [...document.querySelectorAll(`${sel} .lv-task`)];
	const heads = [...document.querySelectorAll(`${sel} .lv-section-name`)].map(
		(h) => h.textContent?.trim() ?? ""
	);
	return rows.filter((r) => {
		const meta = r.querySelector(".lv-task-meta")?.textContent ?? "";
		return heads.some((h) => h && meta.includes(h));
	}).length;
}, PANE);

check(
	"a grouped row does not repeat the heading above it",
	repeats === 0,
	`${repeats} rows restate their section`
);

/* ---------------- completed carries the section it left ---------------- */

/* One click, not one per pane: `completedOpen` is a single piece of view state
   shared by every pane on this page, so opening the second would close the
   first. */
await page.evaluate(() => {
	document
		.querySelector("#sections .lv-completed-head")
		?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await page.waitForTimeout(200);

for (const [what, sel] of [
	["row", "#sections"],
	["card", "#sections-cards"],
]) {
	const found = await page.evaluate((s) => {
		const body = document.querySelector(`${s} .lv-completed-body`);
		if (!body) return { total: 0, tagged: 0 };
		const items = [...body.querySelectorAll(".lv-task, .lv-card-task")];
		return {
			total: items.length,
			tagged: items.filter((i) => i.querySelector(".lv-section-badge")).length,
			text: body.querySelector(".lv-section-badge")?.textContent ?? "",
		};
	}, sel);

	check(
		`a completed ${what} says which section it came from`,
		found.total > 0 && found.tagged === found.total,
		`${found.tagged}/${found.total} tagged, e.g. ${found.text}`
	);
}

/* An open task sits under its heading, so the badge would be the same word
   twice — once in the heading and once on every item beneath it. */
const openTagged = await page.evaluate((sel) => {
	const groups = [...document.querySelectorAll(`${sel} .lv-group`)];
	return groups.flatMap((g) => [...g.querySelectorAll(".lv-section-badge")]).length;
}, PANE);

check("an open row under its heading does not", openTagged === 0, `${openTagged} tagged`);

/* ---------------- the drag reaches across a heading ---------------- */

await page.evaluate(() => (window.lvCalls.length = 0));

/* A real mouse, not a synthesised PointerEvent: pointer capture only works
   against a pointer the browser believes is down, and the capture is half of
   what makes the gesture survive leaving the row.

   Which means the pane has to actually be on screen. This harness page is
   thousands of pixels tall and every pane below the fold has a bounding box the
   mouse can never reach. */
await page.evaluate((sel) => {
	document.querySelector(`${sel} .lv-group`)?.scrollIntoView({ block: "start" });
}, PANE);
await page.waitForTimeout(120);

const boxes = await page.evaluate((sel) => {
	// Runs 1 and 2 are the first two headed sections. Run 0 is the space above
	// the first heading, which this list leaves empty.
	const groups = [...document.querySelectorAll(`${sel} .lv-group`)];
	const card = groups[2]?.querySelector(".lv-task, .lv-card-task");
	if (!card || !groups[1]) return null;
	const c = card.getBoundingClientRect();
	const g = groups[1].getBoundingClientRect();
	return {
		from: { x: c.left + c.width / 2, y: c.top + c.height / 2 },
		to: { x: g.left + g.width / 2, y: g.top + 12 },
		groups: groups.length,
	};
}, PANE);

check("the wall has runs to drag between", !!boxes && boxes.groups >= 2, `${boxes?.groups ?? 0} runs`);

await page.mouse.move(boxes.from.x, boxes.from.y);
await page.mouse.down();
await page.mouse.move(boxes.from.x, boxes.from.y - 20);
await page.mouse.move(boxes.to.x, boxes.to.y, { steps: 6 });

const lit = await page.evaluate(
	(sel) => document.querySelectorAll(`${sel} .lv-drop-target`).length,
	PANE
);
check("the destination run is lit while over it", lit === 1, `${lit} lit`);

/* An empty section is drawn so it can be dropped into, and a div with no
   children has no height to drop onto. It has to grow while a drag is live or
   the drop target it exists to be is unreachable. */
const emptyDuringDrag = await page.evaluate(
	(sel) => document.querySelector(`${sel} .lv-group`)?.getBoundingClientRect().height ?? -1,
	PANE
);
check("an empty run opens a drop zone mid-drag", emptyDuringDrag > 20, `${emptyDuringDrag}px`);

await page.mouse.up();

const kinds = (await page.evaluate(() => window.lvCalls)).map((c) => c[0]);
check(
	"crossing a heading asks for the cross-section move",
	kinds.includes("moveToSection"),
	kinds.join(", ") || "nothing"
);
check("and not a plain reorder", !kinds.includes("reorder"), kinds.join(", "));

const left = await page.evaluate(
	(sel) => document.querySelectorAll(`${sel} .lv-drop-target`).length,
	PANE
);
check("the highlight is cleared on drop", left === 0, `${left} left lit`);

/* ---------------- folding ---------------- */

await page.evaluate(() => (window.lvCalls.length = 0));
await page.click(`${PANE} .lv-section .lv-section-name`, { force: true }).catch(() => {});
await page.waitForTimeout(80);
check(
	"clicking a heading folds without writing to the file",
	(await page.evaluate(() => window.lvCalls)).length === 0
);

/* ---------------- a heading is dragged to reorder ---------------- */

await page.evaluate(() => (window.lvCalls.length = 0));

await page.evaluate((sel) => {
	document.querySelector(`${sel} .lv-group`)?.scrollIntoView({ block: "start" });
}, PANE);
await page.waitForTimeout(120);

const hs = await page.evaluate((sel) => {
	const list = [...document.querySelectorAll(`${sel} .lv-section`)];
	if (list.length < 2) return null;
	const a = list[0].getBoundingClientRect();
	const b = list[1].getBoundingClientRect();
	return {
		from: { x: a.left + 60, y: a.top + a.height / 2 },
		to: { x: a.left + 60, y: b.top + b.height },
	};
}, PANE);

check("there are headings to reorder", !!hs);

await page.mouse.move(hs.from.x, hs.from.y);
await page.mouse.down();
await page.mouse.move(hs.from.x, hs.from.y + 20);
await page.mouse.move(hs.to.x, hs.to.y, { steps: 6 });
await page.mouse.up();

const moved = (await page.evaluate(() => window.lvCalls)).map((c) => c[0]);
check(
	"dragging a heading reorders the section",
	moved.includes("moveSection"),
	moved.join(", ") || "nothing"
);

check("no page errors", errors.length === 0, errors[0] ?? "");

await browser.close();
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
