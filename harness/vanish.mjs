/**
 * Reproduce the vanishing view, faithfully.
 *
 * The mobile harness could not reproduce it because its panels are not
 * height-constrained — the detail panel simply grew taller, which it cannot do
 * inside a real pane. This builds the ancestry Obsidian actually provides:
 * a fixed-height leaf, `.workspace-leaf-content` with `overflow: hidden`, and —
 * in a sidebar, which is where a tablet usually shows this — a `.view-content`
 * with `overflow: auto`, a genuine scroller nobody was guarding.
 *
 * The bug is not visual. It is that focusing a field near the bottom makes the
 * browser scroll one of those ancestors, and an ancestor with no scrollbar can
 * never be scrolled back.
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
   The screen being pushed up.

   The reported symptom, in the user's words: "the whole screen gets
   pushed up when the keyboard rises". That is what a browser does when
   a focused field is under the keyboard and nothing can scroll to reveal
   it — it gives up and scrolls the page, chrome and all, leaving blank
   space behind.

   The answer is not to subtract the keyboard's height; three attempts
   did that and each one subtracted it a second time on top of the one
   Obsidian had already made, which is what collapsed the pane. It is to
   ask whether the view actually hangs past what is visible. Here it is
   made to: the visible bottom is put well above the pane's own bottom,
   as it would be with a keyboard up and no room made.
   ------------------------------------------------------------------ */

const fit = await page.evaluate(() => {
	const root = document.querySelector("#vanish .lv-root");
	// A keyboard is up and nothing has made room for it: the bottom of what
	// can be seen is 300px above the bottom of the window.
	const visibleBottom = window.innerHeight - 300;

	root.style.removeProperty("max-height");
	const before = root.getBoundingClientRect();
	const cap = window.lvVisibleCap({
		top: before.top,
		bottom: before.bottom,
		visibleBottom,
	});
	if (cap !== null) root.style.maxHeight = `${cap}px`;

	const after = root.getBoundingClientRect();
	// Measured again with the cap in place, and *not* cleared first — this is
	// the pass that would shrink it a second time if the cap were a reduction
	// rather than an absolute height.
	const again = window.lvVisibleCap({
		top: after.top,
		bottom: after.bottom,
		visibleBottom,
	});
	return { visibleBottom, cap, beforeBottom: Math.round(before.bottom), afterBottom: Math.round(after.bottom), again, height: Math.round(after.height) };
});

check(
	"a view hanging past the fold is recognised as hanging past it",
	fit.cap !== null,
	`natural bottom ${fit.beforeBottom}, visible to ${fit.visibleBottom}`
);
check(
	"capping it brings it back on screen",
	fit.afterBottom <= fit.visibleBottom + 1,
	`bottom ${fit.beforeBottom} -> ${fit.afterBottom}, visible to ${fit.visibleBottom}`
);
check(
	"and the view still has a usable height rather than collapsing",
	fit.height > 100,
	`${fit.height}px`
);
check(
	"a second pass takes nothing more off — the cap does not compound",
	fit.again === null,
	`second answer ${fit.again}`
);

// And it is given back when the keyboard goes.
const restored = await page.evaluate(() => {
	const root = document.querySelector("#vanish .lv-root");
	const cap = window.lvVisibleCap({
		top: root.getBoundingClientRect().top,
		bottom: root.getBoundingClientRect().bottom,
		visibleBottom: window.innerHeight,
	});
	if (cap === null) root.style.removeProperty("max-height");
	return { cap, height: Math.round(root.getBoundingClientRect().height) };
});
check(
	"with the keyboard gone the cap is dropped, not merely raised",
	restored.cap === null && restored.height > 400,
	`cap=${restored.cap} height=${restored.height}px`
);

/* ------------------------------------------------------------------
   And the rule underneath both of those.

   Obsidian shortens `.app-container` by the keyboard's height before our
   view is laid out, and hides the mobile navbar on keyboardWillShow. So
   by the time we render, the space is already gone and the bar is already
   away. Compensating again subtracts a second keyboard — which is exactly
   what blanked the view on both a phone and a tablet.

   This asserts the absence of that compensation, because absence is not
   something a screenshot shows and is easy to reintroduce while trying to
   fix something else.
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
	"the panel is not lifted again for a keyboard Obsidian already made room for",
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
