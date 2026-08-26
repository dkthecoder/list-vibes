/**
 * The view under a real pane's constraints, with a keyboard up.
 *
 * The other mobile suite renders into panels that can grow, which a workspace
 * leaf cannot — so a panel that should have been squeezed simply got taller and
 * nothing looked wrong. This builds the ancestry Obsidian actually provides:
 * a fixed-height leaf with `contain: strict`, `.workspace-leaf-content` at
 * `overflow: hidden`, and — in a sidebar, which is where a tablet usually shows
 * this — a `.view-content` at `overflow: auto`, a genuine scroller.
 *
 * What it guards is mostly an *absence*: the view must not shorten itself or
 * lift anything for a keyboard the platform has already accounted for. An
 * absence is not something a screenshot shows and is easy to reintroduce while
 * fixing something else.
 */
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const results = [];
const check = (name, pass, detail = "") => {
	results.push({ name, pass, detail });
	console.log(`${pass ? "  ok  " : "  FAIL"} ${name}${detail ? "  — " + detail : ""}`);
};

// A tablet: Obsidian sets is-mobile but NOT is-phone, which is why several
// phone-gated rules do not apply there.
const page = await browser.newPage({
	viewport: { width: 820, height: 1180 },
	isMobile: true,
	hasTouch: true,
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("file://" + process.cwd() + "/harness/index.html");
await page.waitForTimeout(200);

const setup = await page.evaluate(() => {
	document.body.className = "is-mobile is-tablet";

	// The real ancestry, including the sidebar's scrolling .view-content.
	const leaf = document.createElement("div");
	leaf.className = "workspace-leaf";
	leaf.style.cssText =
		"position:relative;height:600px;width:700px;display:flex;flex-direction:column;contain:strict;";
	const content = document.createElement("div");
	content.className = "workspace-leaf-content";
	content.style.cssText = "width:100%;height:100%;overflow:hidden;position:relative;";
	const view = document.createElement("div");
	view.className = "view-content";
	// This is the one that was never guarded: Obsidian sets it in a sidebar.
	view.style.cssText = "width:100%;height:100%;overflow:auto;";

	const src = document.querySelector("#m-detail");
	const clone = src.cloneNode(true);
	clone.id = "vanish";
	clone.style.cssText = "height:100%;";

	view.appendChild(clone);
	content.appendChild(view);
	leaf.appendChild(content);
	document.body.appendChild(leaf);
	leaf.scrollIntoView({ block: "center" });
	return true;
});
check("the tablet ancestry is built", setup);

const STEP = "#vanish .lv-step-input";
const OVERLAY = "#vanish .lv-overlay";

const seen = async (sel) =>
	page.$eval(sel, (e) => {
		const r = e.getBoundingClientRect();
		return { top: Math.round(r.top), h: Math.round(r.height) };
	});

const overlayBefore = await seen(OVERLAY);
check("the detail panel is visible", overlayBefore.h > 0, JSON.stringify(overlayBefore));

// Focus the step field, exactly as tapping it does. No keyboard needed to
// trigger the ancestor scroll — the browser chases the focused element.
await page.$eval(STEP, (e) => e.focus());
await page.waitForTimeout(150);

// And then the keyboard, which is what makes the field fall below the fold.
await page.evaluate(() => {
	document.documentElement.style.setProperty("--keyboard-height", "400px");
	const root = document.querySelector("#vanish .lv-root") ?? document.querySelector("#vanish");
	root.style.setProperty("--lv-keyboard-height", "400px");
	root.classList.add("is-keyboard-open");
	document.querySelector(STEP_SEL)?.scrollIntoView?.({ block: "center" });
}).catch(() => {});
await page.evaluate((sel) => {
	document.querySelector(sel)?.scrollIntoView({ block: "center" });
}, STEP);
await page.waitForTimeout(200);

const scrolledAncestors = await page.evaluate((sel) => {
	const out = [];
	let n = document.querySelector(sel);
	while (n && n !== document.documentElement) {
		if (n.scrollTop > 0) {
			const cs = getComputedStyle(n);
			const scrollable = n.scrollHeight - n.clientHeight > 2;
			out.push(
				`${(n.className || n.tagName).toString().slice(0, 30)} top=${Math.round(n.scrollTop)} overflowY=${cs.overflowY} realOverflow=${scrollable}`
			);
		}
		n = n.parentElement;
	}
	return out;
}, STEP);

check(
	"no ancestor without real overflow was scrolled",
	scrolledAncestors.every((s) => /realOverflow=true/.test(s)),
	scrolledAncestors.length ? scrolledAncestors.join(" | ") : "none scrolled"
);

const overlayAfter = await seen(OVERLAY);
check(
	"the detail panel did not slide out of its pane",
	Math.abs(overlayAfter.top - overlayBefore.top) < 40,
	`top ${overlayBefore.top} -> ${overlayAfter.top}`
);

/* ------------------------------------------------------------------
   An over-large keyboard measurement must not collapse the view.

   The lift is `bottom: var(--lv-keyboard-height)` and the reserve is a
   padding of the same size. Neither is clamped, so a measurement bigger
   than the pane leaves the panel with no height at all and the reserve
   pushes every row out of its scroller — which is exactly "everything
   goes blank". A tablet is where a bad measurement is most likely: it
   is not `.is-phone`, its keyboard can be split or floating, and the
   pane is often far shorter than the screen the measurement came from.
   ------------------------------------------------------------------ */

const paneHeight = await page.$eval("#vanish", (e) => Math.round(e.getBoundingClientRect().height));
await page.evaluate((kb) => {
	const root = document.querySelector("#vanish .lv-root") ?? document.querySelector("#vanish");
	// Through the view's own measurement code, not straight onto the element.
	// The clamp lives in there, and setting the raw number here would prove
	// only that a raw number is dangerous — which nobody doubted.
	const overlap = window.lvKeyboardOverlap({
		native: kb,
		visual: 0,
		viewHeight: root.clientHeight,
	});
	root.style.setProperty("--lv-keyboard-height", `${overlap}px`);
	root.classList.add("is-keyboard-open");
}, 900);
await page.waitForTimeout(150);

const collapsed = await seen(OVERLAY);
check(
	"a keyboard measured taller than the pane does not collapse the panel",
	collapsed.h > 80,
	`pane=${paneHeight}px, measured=900px, panel height=${collapsed.h}px`
);

const scrollPad = await page.$eval(`${OVERLAY} .lv-scroll`, (e) =>
	Math.round(parseFloat(getComputedStyle(e).paddingBottom))
);
check(
	"nor does the reserve exceed the space there is to reserve",
	scrollPad < paneHeight,
	`padding-bottom=${scrollPad}px, pane=${paneHeight}px`
);

/* ------------------------------------------------------------------
   The view does not argue with the viewport.

   The reported symptom was the whole screen sliding upward when the
   keyboard rose — and Obsidian's own editor does the same thing on the
   same device, so it is the webview moving the entire app and none of
   this view's business. Four fixes were aimed at it anyway. Two of them
   (shortening the panel, resetting the page scroll) were fighting a
   behaviour the user already lives with everywhere else in the app, and
   the shortening subtracted a keyboard Obsidian had often already
   subtracted, which is what collapsed the pane.

   What is asserted here is therefore an absence: nothing lifted, nothing
   capped. An absence is not something a screenshot shows and is very easy
   to reintroduce while trying to fix something else — which is how it got
   reintroduced twice.
   ------------------------------------------------------------------ */

const compensation = await page.evaluate(() => {
	const overlay = document.querySelector("#vanish .lv-overlay");
	const root = document.querySelector("#vanish .lv-root") ?? document.querySelector("#vanish");
	return {
		lift: getComputedStyle(overlay).bottom,
		reserve: getComputedStyle(root).getPropertyValue("--lv-navbar-clearance").trim(),
	};
});
check(
	"the panel is not lifted for a keyboard the platform already accounted for",
	compensation.lift === "0px",
	`bottom=${compensation.lift}`
);
check(
	"and nothing is reserved for a navbar Obsidian has already hidden",
	compensation.reserve === "0px" || compensation.reserve === "0",
	`clearance=${compensation.reserve}`
);

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
