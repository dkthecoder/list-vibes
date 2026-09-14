/**
 * Confetti fires, and reduced motion means none of it.
 *
 * "None" rather than "less" is the whole point of the rule, and it is the
 * kind of thing that is easy to half-implement — a shorter burst still moves.
 * The canvas is also checked for being inert: it covers the whole viewport, so
 * a pointer-events slip would swallow every click in the app for a second.
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
const BOX = `${PANE} .lv-task:not(.is-complete) > .task-list-item-checkbox`;

/**
 * Tick the first open task and report what landed on the page.
 *
 * The checkbox is measured *after* the click, because clicking scrolls it into
 * view and a rect taken before would be off the page.
 */
async function tickAndInspect(page) {
	await page.goto(url);
	await page.waitForTimeout(200);
	await page.click(BOX);
	await page.waitForTimeout(30);
	return page.evaluate((sel) => {
		const target = document.querySelector(sel).getBoundingClientRect();
		const c = document.querySelector("canvas.lv-confetti");
		if (!c) return { canvas: false };
		const cs = getComputedStyle(c);
		const box = c.getBoundingClientRect();
		const ctx2 = c.getContext("2d");
		const { data } = ctx2.getImageData(0, 0, c.width, c.height);
		let sx = 0, sy = 0, n = 0;
		for (let i = 0; i < data.length; i += 4) {
			if (data[i + 3] > 0) {
				sx += (i / 4) % c.width;
				sy += Math.floor(i / 4 / c.width);
				n++;
			}
		}
		// The canvas box in CSS pixels, against the bitmap in device pixels.
		const scaleX = box.width / c.width;
		const scaleY = box.height / c.height;
		return {
			canvas: true,
			viewport: [window.innerWidth, window.innerHeight],
			cssBox: [Math.round(box.width), Math.round(box.height)],
			aim: n
				? [
						Math.round(box.left + (sx / n) * scaleX - (target.left + target.width / 2)),
						Math.round(box.top + (sy / n) * scaleY - (target.top + target.height / 2)),
					]
				: null,
			pointer: cs.pointerEvents,
			position: cs.position,
			background: cs.backgroundColor,
			painted: n,
		};
	}, BOX);
}

// deviceScaleFactor 2 on purpose: the canvas once rendered at twice the
// viewport on a retina screen, because `inset: 0` does not stretch a replaced
// element, and the burst landed at twice the coordinate it was aimed at.
const page = await browser.newPage({
	viewport: { width: 1180, height: 900 },
	deviceScaleFactor: 2,
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const normal = await tickAndInspect(page);
check("ticking a task throws confetti", normal.canvas === true, JSON.stringify(normal.canvas));
check("and something is actually painted on it", (normal.painted ?? 0) > 0, `${normal.painted} lit pixels`);
check(
	"the canvas covers the viewport and no more",
	JSON.stringify(normal.cssBox) === JSON.stringify(normal.viewport),
	`canvas=${JSON.stringify(normal.cssBox)} viewport=${JSON.stringify(normal.viewport)}`
);

// Sideways is the one that has to be tight: the burst is symmetrical, so any
// aiming error shows in x. Vertically it is a band, because the particles are
// already rising by the time there is anything to measure — the retina bug
// this guards put the burst 294px out in x, which either bound catches.
check(
	"and the burst comes from the checkbox that was ticked",
	normal.aim !== null && Math.abs(normal.aim[0]) <= 20 && normal.aim[1] > -140 && normal.aim[1] < 20,
	`centroid ${JSON.stringify(normal.aim)}px from the box`
);

check(
	"the canvas cannot be clicked, so it does not swallow the app",
	normal.pointer === "none",
	`pointer-events=${normal.pointer}`
);
check(
	"and it carries no colour of its own",
	normal.background === "rgba(0, 0, 0, 0)",
	`background=${normal.background}`
);

await page.emulateMedia({ reducedMotion: "reduce" });
const reduced = await tickAndInspect(page);
check(
	"reduced motion means no confetti at all, not a shorter burst",
	reduced.canvas === false,
	JSON.stringify(reduced)
);

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
