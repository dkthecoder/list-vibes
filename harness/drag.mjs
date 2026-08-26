/**
 * Drive a real drag in a real browser.
 *
 * The unit tests cover the drop arithmetic, but the gesture itself — pointer
 * capture, the mouse threshold, the touch long press, and the rule that a
 * scroll must stay a scroll — only exists as event handling, and the only
 * honest way to check event handling is to send events.
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

/* Dragging is only offered under the file's own order with nothing selected.
   #desktop2 is sorted by importance and correctly refuses; #desktop has the
   detail overlay open, and its backdrop covers the whole pane by design, so no
   pointer reaches a row there at all. */
const PANE = "#drag";

const rows = async () =>
	page.$$eval(`${PANE} .lv-group > .lv-task`, (els) =>
		els.map((e) => e.querySelector(".lv-task-title")?.textContent?.trim())
	);

// page.mouse dispatches at viewport coordinates, so the panel has to actually
// be on screen — off-screen coordinates silently hit nothing at all.
await page.$eval(PANE, (el) => el.scrollIntoView({ block: "center" }));
await page.waitForTimeout(100);

const before = await rows();
check("rows render and are sortable", before.length >= 3, `${before.length} rows`);

const sortableCount = await page.$$eval(`${PANE} .lv-task.lv-sortable`, (e) => e.length);
check("every row is marked sortable", sortableCount === before.length,
	`${sortableCount}/${before.length}`);

// The importance-sorted panel must refuse: its order is computed, so a drop
// there would write a change the sort immediately undoes.
const sortedPane = await page.$$eval("#desktop2 .lv-task.lv-sortable", (e) => e.length);
check("a non-custom sort offers no drag at all", sortedPane === 0, `${sortedPane} sortable`);

// Nor does the post-it wall, which wraps into a grid.
const postitPane = await page.$$eval("#cards .lv-task.lv-sortable", (e) => e.length);
check("the post-it wall offers no drag either", postitPane === 0, `${postitPane} sortable`);

/* ---- a mouse drag from the first row down past the second ---- */
const box = async (i) =>
	page.$eval(`${PANE} .lv-group > .lv-task:nth-child(${i + 1})`, (el) => {
		const r = el.getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height };
	});

const first = await box(0);
const second = await box(1);

await page.mouse.move(first.x, first.y);
await page.mouse.down();
// Past the mouse threshold in small steps, the way a real pointer arrives, and
// clearly beyond the second row's centre — a drop exactly on a midpoint is a
// deliberate no-move, so a test that stops there proves nothing.
for (let y = first.y; y <= second.y + 12; y += 6) {
	await page.mouse.move(first.x, y);
}
const lifted = await page.$$eval(`${PANE} .lv-task.lv-dragging`, (e) => e.length);
check("the row lifts once the threshold is passed", lifted === 1, `${lifted} lifted`);

const shifted = await page.$$eval(`${PANE} .lv-task.lv-shifted`, (e) => e.length);
check("the row being passed slides out of the way", shifted === 1, `${shifted} shifted`);

await page.mouse.up();
await page.waitForTimeout(50);

let calls = await page.evaluate(() => window.lvCalls);
const drop = calls.find((c) => c[0] === "reorder");
check("the drop asks for a reorder", !!drop, JSON.stringify(drop?.[0]));
check("it reorders from 0 to 1", drop && drop[3] === 1, `toIndex=${drop?.[3]}`);

const cleared = await page.$$eval(
	`${PANE} .lv-task.lv-dragging, ${PANE} .lv-task.lv-shifted`,
	(e) => e.length
);
check("drag state is cleared on drop", cleared === 0, `${cleared} left over`);
const bodyClass = await page.evaluate(() => document.body.className);
check("the body drag class is cleared", !bodyClass.includes("lv-is-dragging"), bodyClass);

/* ---- and a drag must not be read as a click ----

   The other half of the same coin, and the one that actually shipped broken.
   `pointerup` is not the end of the gesture: the browser goes on to dispatch
   `mouseup` and then `click` on the same row, and a task row's click opens the
   detail panel. So reordering a list also opened the editor — on a task whose
   line the drop had just moved, so it opened empty. Real mouse events here, not
   synthetic ones, because the click is the browser's and only the browser can
   send it. */
check(
	"the drag did not also open the task it moved",
	!calls.some((c) => c[0] === "selectTask"),
	JSON.stringify(calls.map((c) => c[0]))
);

/* ---- a click must not be read as a drag ---- */
await page.evaluate(() => (window.lvCalls.length = 0));
await page.mouse.move(first.x, first.y);
await page.mouse.down();
await page.mouse.move(first.x, first.y + 2); // inside the threshold
await page.mouse.up();
await page.waitForTimeout(50);
calls = await page.evaluate(() => window.lvCalls);
check(
	"a click with a tiny wobble is not a drag",
	!calls.some((c) => c[0] === "reorder"),
	JSON.stringify(calls.map((c) => c[0]))
);
check(
	"and still opens the task, because suppressing every click would be worse",
	calls.some((c) => c[0] === "selectTask"),
	JSON.stringify(calls.map((c) => c[0]))
);

/* ---- dropping a row back where it started writes nothing ---- */
await page.evaluate(() => (window.lvCalls.length = 0));
await page.mouse.move(first.x, first.y);
await page.mouse.down();
for (let y = first.y; y <= first.y + 20; y += 5) await page.mouse.move(first.x, y);
for (let y = first.y + 20; y >= first.y; y -= 5) await page.mouse.move(first.x, y);
await page.mouse.up();
await page.waitForTimeout(50);
calls = await page.evaluate(() => window.lvCalls);
check(
	"an abandoned drag does not open the task either",
	!calls.some((c) => c[0] === "selectTask"),
	JSON.stringify(calls.map((c) => c[0]))
);
check(
	"a drag that returns to its start writes nothing",
	!calls.some((c) => c[0] === "reorder"),
	JSON.stringify(calls.map((c) => c[0]))
);

/* ---- touch: a swipe must stay a scroll ---- */
await page.evaluate(() => (window.lvCalls.length = 0));
const swipe = await page.evaluate(
	({ pane, x, y }) => {
		const row = document.querySelector(`${pane} .lv-group > .lv-task`);
		const ev = (type, cy) =>
			row.dispatchEvent(
				new PointerEvent(type, {
					pointerId: 1,
					pointerType: "touch",
					clientX: x,
					clientY: cy,
					bubbles: true,
					button: 0,
				})
			);
		// Obsidian's own pointer capture is not available on a bare element in
		// this harness, so stub it out rather than let it throw.
		row.setPointerCapture = () => {};
		row.releasePointerCapture = () => {};
		row.hasPointerCapture = () => false;
		ev("pointerdown", y);
		for (let d = 4; d <= 40; d += 4) ev("pointermove", y + d);
		ev("pointerup", y + 40);
		return document.querySelectorAll(`${pane} .lv-dragging`).length;
	},
	{ pane: PANE, x: first.x, y: first.y }
);
check("a touch swipe scrolls rather than dragging", swipe === 0, `${swipe} lifted`);
calls = await page.evaluate(() => window.lvCalls);
check(
	"and it writes nothing",
	!calls.some((c) => c[0] === "reorder"),
	JSON.stringify(calls.map((c) => c[0]))
);

/* ---- touch: a long press does start a drag ---- */
await page.evaluate(() => (window.lvCalls.length = 0));
await page.evaluate(
	({ pane, x, y }) => {
		const row = document.querySelector(`${pane} .lv-group > .lv-task`);
		row.setPointerCapture = () => {};
		row.releasePointerCapture = () => {};
		row.hasPointerCapture = () => false;
		window.__lvRow = row;
		window.__lvEv = (type, cy) =>
			row.dispatchEvent(
				new PointerEvent(type, {
					pointerId: 2,
					pointerType: "touch",
					clientX: x,
					clientY: cy,
					bubbles: true,
					button: 0,
				})
			);
		window.__lvEv("pointerdown", y);
	},
	{ pane: PANE, x: first.x, y: first.y }
);
await page.waitForTimeout(600); // outlast the long press
const held = await page.$$eval(`${PANE} .lv-task.lv-dragging`, (e) => e.length);
check("a long press arms the drag", held === 1, `${held} lifted`);

await page.evaluate(
	(sy) => {
		for (let d = 10; d <= 60; d += 10) window.__lvEv("pointermove", sy + d);
		window.__lvEv("pointerup", sy + 60);
	},
	first.y
);
await page.waitForTimeout(50);
calls = await page.evaluate(() => window.lvCalls);
check(
	"and dragging after it reorders",
	calls.some((c) => c[0] === "reorder"),
	JSON.stringify(calls.map((c) => c[0]))
);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
