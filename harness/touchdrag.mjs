/**
 * Reordering by real touch, and scrolling that survives it.
 *
 * Every other drag check here synthesises `PointerEvent`s, which can show that
 * the code reacts but never what the *browser* decides. And the browser is the
 * whole problem on touch: it commits to scrolling on the first `touchmove` —
 * the only one that is cancelable — so `preventDefault` arrives too late and a
 * drag that armed 450ms into a long press had already lost the gesture. A row
 * lifted, nothing moved, and every suite passed.
 *
 * The only declarative way to claim a gesture is `touch-action`, read when the
 * touch begins. So the surface under the finger has to say "not a scroll" up
 * front, which is what the grip is for, and why the grip is the only way to start
 * a drag rather than one of two ways.
 *
 * Driven through CDP's `Input.dispatchTouchEvent`, which produces real touches:
 * real hit-testing, real scroll decisions, real `pointercancel`.
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
const ROW = `${PANE} .lv-group:not(.lv-starred-run) > .lv-task`;

/** A page with a real touchscreen, scrolled so the row under test is in view. */
async function touchPage() {
	const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, hasTouch: true });
	const cdp = await page.context().newCDPSession(page);
	await page.goto(url);
	await page.waitForTimeout(250);
	await page.evaluate((row) => {
		document.querySelector(row).scrollIntoView({ block: "center" });
		window.lvCalls.length = 0;
		window.__cancelled = false;
		document
			.querySelector(row)
			.addEventListener("pointercancel", () => (window.__cancelled = true), true);
	}, ROW);
	await page.waitForTimeout(120);
	return { page, cdp };
}

/** Where a selector's centre is, in viewport coordinates. */
async function centreOf(page, selector) {
	return page.evaluate((s) => {
		const el = document.querySelector(s);
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
	}, selector);
}

/**
 * Drag with a finger from `from` downward by `dy`, wandering `wander` px first.
 *
 * The wander is the point of the test rather than realism: a finger is never
 * perfectly still, and it was a 3px wander that used to lose the gesture.
 */
async function fingerDrag({ page, cdp }, from, dy, wander = 0) {
	const touch = (type, y) =>
		cdp.send("Input.dispatchTouchEvent", {
			type,
			touchPoints: type === "touchEnd" ? [] : [{ x: from.x, y, radiusX: 10, radiusY: 10, force: 1 }],
		});
	await touch("touchStart", from.y);
	for (let i = 1; i <= wander; i++) {
		await touch("touchMove", from.y + i);
		await page.waitForTimeout(20);
	}
	for (let d = wander + 8; d <= wander + dy; d += 8) {
		await touch("touchMove", from.y + d);
		await page.waitForTimeout(16);
	}
	await touch("touchEnd", from.y + wander + dy);
	await page.waitForTimeout(80);
	return page.evaluate(() => ({
		reordered: window.lvCalls.some((c) => c[0] === "reorder"),
		cancelled: window.__cancelled,
		calls: window.lvCalls.map((c) => c[0]),
	}));
}

/* ------------------------------------------------------------------
   1. There is a grip, and it declines the gesture up front
   ------------------------------------------------------------------ */

{
	const { page } = await touchPage();
	const grip = await centreOf(page, `${ROW} .lv-grip`);
	check("every row has a grip", grip !== null, grip ? `${Math.round(grip.w)}x${Math.round(grip.h)}px` : "none");

	const action = await page.evaluate((row) => {
		const g = document.querySelector(`${row} .lv-grip`);
		return g ? getComputedStyle(g).touchAction : null;
	}, ROW);
	check(
		"the grip tells the browser not to scroll from it",
		action === "none",
		`touch-action: ${action}`
	);

	// And the row does not, or swiping a list would stop scrolling it.
	const rowAction = await page.evaluate((row) => getComputedStyle(document.querySelector(row)).touchAction, ROW);
	check(
		"and the row itself still leaves scrolling alone",
		rowAction !== "none",
		`touch-action: ${rowAction}`
	);
	await page.close();
}

/* ------------------------------------------------------------------
   2. A finger on the grip reorders — steady, and not
   ------------------------------------------------------------------ */

for (const wander of [0, 3, 6, 12]) {
	const ctx = await touchPage();
	const grip = await centreOf(ctx.page, `${ROW} .lv-grip`);
	if (!grip) {
		check(`a finger drag from the grip reorders (wander ${wander}px)`, false, "no grip to drag");
		await ctx.page.close();
		continue;
	}
	const r = await fingerDrag(ctx, grip, 130, wander);
	check(
		`a finger drag from the grip reorders, wander ${wander}px`,
		r.reordered,
		`cancelled=${r.cancelled} calls=${JSON.stringify(r.calls)}`
	);
	await ctx.page.close();
}

/* ------------------------------------------------------------------
   3. A finger on the row body is still a scroll
   ------------------------------------------------------------------ */

{
	const ctx = await touchPage();
	const title = await centreOf(ctx.page, `${ROW} .lv-task-title`);
	const r = await fingerDrag(ctx, title, 120, 0);
	check(
		"a finger on the row body does not reorder — that gesture is the scroll",
		!r.reordered,
		JSON.stringify(r.calls)
	);
	await ctx.page.close();
}

/* ------------------------------------------------------------------
   4. A mouse on the grip reorders too — one mechanism, every input
   ------------------------------------------------------------------ */

{
	const { page } = await touchPage();
	const grip = await centreOf(page, `${ROW} .lv-grip`);
	if (!grip) {
		check("a mouse drag from the grip reorders", false, "no grip to drag");
	} else {
		await page.mouse.move(grip.x, grip.y);
		await page.mouse.down();
		for (let y = grip.y; y <= grip.y + 130; y += 10) await page.mouse.move(grip.x, y);
		await page.mouse.up();
		await page.waitForTimeout(80);
		const calls = await page.evaluate(() => window.lvCalls.map((c) => c[0]));
		check(
			"a mouse drag from the grip reorders — the same path, not a second one",
			calls.includes("reorder"),
			JSON.stringify(calls)
		);
	}
	await page.close();
}

/* ------------------------------------------------------------------ */

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
