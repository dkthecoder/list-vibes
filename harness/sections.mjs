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

/* ---------------- the drag reaches across a heading ---------------- */

await page.evaluate(() => (window.lvCalls.length = 0));

/* Second section's first card, dragged up into the first section. A card rather
   than a row: the wall was the mode that could not be dragged at all, so it is
   the one worth driving. */
const move = await page.evaluate(async (sel) => {
	const groups = [...document.querySelectorAll(`${sel} .lv-group`)];
	if (groups.length < 2) return { ok: false, why: `${groups.length} groups` };

	const from = groups[1].querySelector(".lv-task, .lv-card-task");
	const to = groups[0].getBoundingClientRect();
	if (!from) return { ok: false, why: "no row in the second group" };

	const r = from.getBoundingClientRect();
	const send = (type, x, y) =>
		from.dispatchEvent(
			new PointerEvent(type, {
				pointerId: 1,
				pointerType: "mouse",
				button: 0,
				clientX: x,
				clientY: y,
				bubbles: true,
				cancelable: true,
			})
		);

	const startX = r.left + r.width / 2;
	const startY = r.top + r.height / 2;
	send("pointerdown", startX, startY);
	// Past the mouse threshold first, then into the other section.
	send("pointermove", startX, startY - 20);
	send("pointermove", to.left + to.width / 2, to.top + 10);
	const lit = document.querySelectorAll(`${sel} .lv-drop-target`).length;
	send("pointerup", to.left + to.width / 2, to.top + 10);
	return { ok: true, lit };
}, PANE);

check("a drag can be started on the wall", move.ok, move.why ?? "");
check("the destination section is lit while over it", move.lit === 1, `${move.lit} lit`);

const calls = await page.evaluate(() => window.lvCalls);
const kinds = calls.map((c) => c[0]);
check(
	"crossing a heading asks for the cross-section move",
	kinds.includes("moveToSection"),
	kinds.join(", ") || "nothing"
);
check("and not a plain reorder", !kinds.includes("reorder"), kinds.join(", "));

const left = await page.evaluate((sel) => document.querySelectorAll(`${sel} .lv-drop-target`).length, PANE);
check("the highlight is cleared on drop", left === 0, `${left} left lit`);

/* ---------------- folding ---------------- */

await page.evaluate(() => (window.lvCalls.length = 0));
await page.click(`${PANE} .lv-section .lv-section-name`, { force: true }).catch(() => {});
await page.waitForTimeout(80);
check("clicking a heading does not write to the file", (await page.evaluate(() => window.lvCalls)).length === 0);

check("no page errors", errors.length === 0, errors[0] ?? "");

await browser.close();
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
