/**
 * Swiping the detail panel away.
 *
 * The arithmetic — is this a swipe, does letting go dismiss — is unit-tested.
 * What cannot be unit-tested is whether the gesture ever reaches the code at
 * all: `touch-action` decides whether the browser keeps the horizontal pan for
 * itself, pointer capture decides whether the rest of the drag arrives once the
 * finger leaves the panel, and the transition decides whether the panel follows
 * the finger or lags a fifth of a second behind it. All three are silent when
 * wrong. So this drags the real panel with a real touch pointer.
 */
import { chromium } from "playwright";

const url = "file://" + process.cwd() + "/harness/index.html";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

const results = [];
const check = (name, pass, detail = "") => {
	results.push({ name, pass, detail });
	console.log(`${pass ? "  ok  " : "  FAIL"} ${name}${detail ? "  — " + detail : ""}`);
};

const page = await browser.newPage({
	viewport: { width: 390, height: 844 },
	isMobile: true,
	hasTouch: true,
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url);
await page.evaluate(() => document.body.classList.add("is-phone", "is-mobile"));
await page.waitForTimeout(200);

const PANEL = "#m-detail .lv-overlay";

const box = async (sel) =>
	page.$eval(sel, (e) => {
		const r = e.getBoundingClientRect();
		return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right };
	});

/**
 * A touch drag, dispatched as pointer events.
 *
 * Playwright's touchscreen helper cannot express a slow drag with intermediate
 * points, and intermediate points are the whole gesture: the code decides
 * whether this is a swipe from the first few of them.
 */
const drag = async (sel, { dx, dy, steps = 8, pause = 0, release = true }) => {
	await page.$eval(
		sel,
		(el, { dx, dy, steps, pause, release }) => {
			const r = el.getBoundingClientRect();
			// Start well inside the panel and clear of any field, so the gesture
			// is not rejected for landing on an input.
			const x0 = r.left + r.width * 0.5;
			const y0 = r.top + r.height * 0.75;
			const send = (type, x, y, t) =>
				el.dispatchEvent(
					new PointerEvent(type, {
						pointerId: 7,
						pointerType: "touch",
						isPrimary: true,
						clientX: x,
						clientY: y,
						bubbles: true,
						cancelable: true,
					})
				) && t;
			// setPointerCapture throws for a pointer the element is not
			// tracking; in a synthetic event there is no real pointer, so it is
			// stubbed for the duration of the drag.
			const realCapture = el.setPointerCapture;
			el.setPointerCapture = () => {};
			send("pointerdown", x0, y0);
			for (let i = 1; i <= steps; i++) {
				send("pointermove", x0 + (dx * i) / steps, y0 + (dy * i) / steps);
			}
			if (release) {
				const up = new PointerEvent("pointerup", {
					pointerId: 7,
					pointerType: "touch",
					isPrimary: true,
					clientX: x0 + dx,
					clientY: y0 + dy,
					bubbles: true,
				});
				// The gesture's duration decides whether it counts as a flick.
				Object.defineProperty(up, "timeStamp", { value: performance.now() + pause });
				el.dispatchEvent(up);
			}
			el.setPointerCapture = realCapture;
		},
		{ dx, dy, steps, pause, release }
	);
};

const transform = (sel) => page.$eval(sel, (e) => getComputedStyle(e).transform);
const shifted = (t) => {
	const m = /matrix\(1, 0, 0, 1, (-?[\d.]+)/.exec(t);
	return m ? Math.round(Number(m[1])) : 0;
};

/* ------------------------------------------------------------------
   0. The gesture can reach us at all
   ------------------------------------------------------------------ */

const touchAction = await page.$eval(PANEL, (e) => getComputedStyle(e).touchAction);
check(
	"the browser leaves the horizontal gesture to us and keeps the vertical one",
	touchAction === "pan-y",
	touchAction
);

/*
 * Obsidian's own drawer swipe.
 *
 * This is the fault the gesture actually had in Obsidian and could never have
 * had here: core watches for a horizontal drag anywhere in the app and opens
 * the left sidebar, so swiping the panel opened the sidebar instead of
 * dismissing it. `touch-action` does not stop a JS gesture. Core's handler
 * walks up from whatever was touched and gives up on the first ancestor with
 * `data-ignore-swipe`, which is how it exempts its own sliders and canvas.
 *
 * There is no core here to be stopped, so what is checked is the opt-out being
 * on the element — the one thing that would silently stop being true if the
 * attribute were dropped in a refactor.
 */
const optOut = await page.$eval(PANEL, (e) => e.dataset.ignoreSwipe ?? null);
check("the panel opts out of Obsidian's own drawer swipe", optOut === "true", String(optOut));

const start = await box(PANEL);
check("the panel is on screen to begin with", start.w > 0 && start.h > 0, JSON.stringify(start));

/* ------------------------------------------------------------------
   1. It follows the finger
   ------------------------------------------------------------------ */

await drag(PANEL, { dx: 90, dy: 0, release: false });
await page.waitForTimeout(30);

const held = await transform(PANEL);
check("a drag across moves the panel with it", shifted(held) >= 80, held);

const dragging = await page.$eval(PANEL, (e) => ({
	cls: e.classList.contains("is-dragging"),
	transition: getComputedStyle(e).transitionDuration,
}));
check(
	"and the transition is out of the way while it does",
	dragging.cls && /^0s?/.test(dragging.transition),
	`is-dragging=${dragging.cls} transition=${dragging.transition}`
);

const backdropFade = await page.$eval("#m-detail .lv-backdrop", (e) =>
	Number(getComputedStyle(e).opacity)
);
check(
	"the backdrop fades in step, so the list comes back gradually",
	backdropFade < 1 && backdropFade > 0,
	String(backdropFade)
);

/* ------------------------------------------------------------------
   2. A small drag springs back
   ------------------------------------------------------------------ */

await page.reload();
await page.evaluate(() => document.body.classList.add("is-phone", "is-mobile"));
await page.waitForTimeout(200);

await drag(PANEL, { dx: 30, dy: 0, pause: 900 });
await page.waitForTimeout(300);

const back = await page.$eval(PANEL, (e) => ({
	open: e.classList.contains("is-open"),
	dragging: e.classList.contains("is-dragging"),
	inline: e.style.transform,
	shift: getComputedStyle(e).transform,
}));
check("a short slow drag leaves the panel open", back.open, JSON.stringify(back));
check("it returns to where it was", shifted(back.shift) === 0, back.shift);
check("and the stylesheet has it back", !back.dragging && back.inline === "", JSON.stringify(back));

/* ------------------------------------------------------------------
   3. A vertical drag is a scroll, not a swipe
   ------------------------------------------------------------------ */

await page.reload();
await page.evaluate(() => document.body.classList.add("is-phone", "is-mobile"));
await page.waitForTimeout(200);

// 20 across, 120 down: a thumb going up the panel, never quite straight.
await drag(PANEL, { dx: 20, dy: -120, release: false });
await page.waitForTimeout(30);
const duringScroll = await transform(PANEL);
check(
	"a scroll that wanders sideways does not drag the panel",
	shifted(duringScroll) === 0,
	duringScroll
);

/* ------------------------------------------------------------------
   4. A long drag dismisses it
   ------------------------------------------------------------------ */

await page.reload();
await page.evaluate(() => document.body.classList.add("is-phone", "is-mobile"));
await page.waitForTimeout(200);

const width = (await box(PANEL)).w;
await drag(PANEL, { dx: Math.round(width * 0.6), dy: 0, pause: 900 });
await page.waitForTimeout(60);

const closing = await page.$eval(PANEL, (e) => e.classList.contains("is-open"));
check("a drag most of the way across closes the panel", !closing);

await page.waitForTimeout(320);
const gone = await page.evaluate(() => window.lvDismissed ?? 0);
check("and the view is told, once the panel has finished leaving", gone === 1, `dismissed=${gone}`);

/* ------------------------------------------------------------------
   5. A flick dismisses without going far
   ------------------------------------------------------------------ */

await page.reload();
await page.evaluate(() => document.body.classList.add("is-phone", "is-mobile"));
await page.waitForTimeout(200);

await drag(PANEL, { dx: 50, dy: 0, steps: 3, pause: 40 });
await page.waitForTimeout(400);
const flicked = await page.evaluate(() => window.lvDismissed ?? 0);
check("a short fast flick closes it too", flicked === 1, `dismissed=${flicked}`);

/* ------------------------------------------------------------------
   6. A pinned panel is furniture, not a card to be thrown away
   ------------------------------------------------------------------ */

const pinnedAction = await page.$eval("#pinned .lv-overlay.is-pinned", (e) =>
	getComputedStyle(e).touchAction
);
check(
	"a pinned panel keeps the browser's own gestures",
	pinnedAction !== "pan-y",
	pinnedAction
);

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
