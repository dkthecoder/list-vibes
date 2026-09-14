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

/** Tick the first open task and report what landed on the page. */
async function tickAndInspect(page) {
	await page.goto(url);
	await page.waitForTimeout(200);
	await page.click(BOX);
	await page.waitForTimeout(60);
	return page.evaluate(() => {
		const c = document.querySelector("canvas.lv-confetti");
		if (!c) return { canvas: false };
		const cs = getComputedStyle(c);
		return {
			canvas: true,
			pointer: cs.pointerEvents,
			position: cs.position,
			background: cs.backgroundColor,
			painted: (() => {
				const ctx = c.getContext("2d");
				const { data } = ctx.getImageData(0, 0, c.width, c.height);
				let lit = 0;
				for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit++;
				return lit;
			})(),
		};
	});
}

const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const normal = await tickAndInspect(page);
check("ticking a task throws confetti", normal.canvas === true, JSON.stringify(normal.canvas));
check("and something is actually painted on it", (normal.painted ?? 0) > 0, `${normal.painted} lit pixels`);
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
