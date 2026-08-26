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
	// The app shell, which is the box that takes Obsidian's own header and
	// navigation bar with it when something scrolls it. Guarding the two boxes
	// nearest the view left this one free to be scrolled, and scrolling this one
	// is what "the whole screen goes blank" is.
	const app = document.createElement("div");
	app.className = "app-container";
	// Shorter than what it holds, which is the situation the keyboard creates:
	// the shell is clamped, its contents are not, and now it has somewhere to
	// scroll to. Sized to fit exactly and there would be no overflow, so the
	// check below would pass without meaning anything.
	app.style.cssText = "position:relative;height:500px;width:700px;overflow:hidden;";
	const chrome = document.createElement("div");
	chrome.className = "app-chrome-probe";
	chrome.style.cssText = "height:40px;width:100%;background:var(--background-secondary);";

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
	app.appendChild(chrome);
	app.appendChild(leaf);
	document.body.appendChild(app);

	// Arm the guard the view arms, over the chain the view would walk.
	window.lvPinnedChain = window.lvPinAncestors(view.querySelector(".lv-root") ?? view);
	app.scrollIntoView({ block: "center" });
	return window.lvPinnedChain;
});
check("the tablet ancestry is built", Array.isArray(setup) && setup.length > 0, JSON.stringify(setup));
check(
	"and the guard walked as far as the app shell",
	Array.isArray(setup) && setup.some((c) => String(c).includes("app-container")),
	JSON.stringify(setup)
);

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

/* ------------------------------------------------------------------
   The app shell being scrolled is the whole screen going blank

   Whichever ancestor answers "yes, I can scroll to reveal that field"
   decides how much disappears. `.view-content` takes the view; the app
   shell takes Obsidian's own header and navigation bar with it, and
   because it has no scrollbar nobody can bring any of it back until the
   keyboard closes. Guarding two named boxes left this one free.
   ------------------------------------------------------------------ */

const shell = await page.evaluate(() => {
	const app = document.querySelector(".app-container");
	const chrome = document.querySelector(".app-chrome-probe");
	const before = Math.round(chrome.getBoundingClientRect().top);

	// Exactly what the browser does to reveal a field it cannot otherwise
	// reach — an offset on a box with no scrollbar.
	app.scrollTop = 300;
	const moved = app.scrollTop;

	return new Promise((resolve) =>
		requestAnimationFrame(() =>
			setTimeout(
				() =>
					resolve({
						moved,
						after: app.scrollTop,
						chromeBefore: before,
						chromeAfter: Math.round(chrome.getBoundingClientRect().top),
					}),
				30
			)
		)
	);
});

check(
	"the app shell can be scrolled at all — otherwise this proves nothing",
	shell.moved > 0,
	`scrollTop reached ${shell.moved}`
);
check(
	"but it is put straight back",
	shell.after === 0,
	`scrollTop ${shell.moved} -> ${shell.after}`
);
check(
	"so Obsidian's own chrome stays where it was",
	shell.chromeAfter === shell.chromeBefore,
	`chrome top ${shell.chromeBefore} -> ${shell.chromeAfter}`
);

/*
 * Core's own rule, recreated verbatim from what the plugin read off the device,
 * so the assumption underneath everything else here is checked rather than
 * carried.
 *
 * There used to be an override of this rule below, on a theory that Android
 * subtracted the keyboard twice. The device says otherwise — with the keyboard
 * up, inner, 100vh, 100dvh and visualViewport all held at 891 while
 * --keyboard-height was 463 and the app was 428 — so the subtraction happens
 * once and is correct. What survives is a check that the rule does what it
 * says, and that nothing of ours quietly reaches over it.
 */
const cascade = await page.evaluate(() => {
	const core = document.createElement("style");
	core.textContent =
		"body.is-mobile .app-container { max-height: calc(100vh - var(--keyboard-height)); }";
	// First in the document, exactly as core's stylesheet is.
	document.head.insertBefore(core, document.head.firstChild);
	document.documentElement.style.setProperty("--keyboard-height", "400px");

	const app = document.querySelector(".app-container");
	const capped = Math.round(parseFloat(getComputedStyle(app).maxHeight));

	// `100vh` measured rather than assumed: under device emulation it is not
	// window.innerHeight, and a check written against the wrong one would be
	// testing the harness instead of the stylesheet.
	const probe = document.createElement("div");
	probe.style.cssText = "position:fixed;top:0;left:0;width:1px;height:100vh;";
	document.body.appendChild(probe);
	const vh = Math.round(probe.getBoundingClientRect().height);
	probe.remove();

	return { capped, vh };
});

check(
	"core shortens the app by exactly one keyboard",
	cascade.capped === cascade.vh - 400,
	`max-height ${cascade.capped} against ${cascade.vh} of viewport`
);
check(
	"and nothing of ours reaches over it",
	cascade.capped === cascade.vh - 400,
	`still ${cascade.capped}`
);

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
