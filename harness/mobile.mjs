/**
 * Reproduce the mobile add box, keyboard and all.
 *
 * Two reported faults live here and neither is visible on desktop: typing into
 * the add box comes out reversed, and raising the keyboard blanks the view. Both
 * are behaviour under a phone viewport with a focused field, so they are
 * reproduced by focusing a field under a phone viewport rather than reasoned
 * about.
 */
import { chromium } from "playwright";

const url = "file://" + process.cwd() + "/harness/index.html";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

const results = [];
const check = (name, pass, detail = "") => {
	results.push({ name, pass, detail });
	console.log(`${pass ? "  ok  " : "  FAIL"} ${name}${detail ? "  — " + detail : ""}`);
};

// A phone, as Obsidian sees one: narrow viewport plus the body classes core
// sets, which is what our own mobile CSS keys off.
const page = await browser.newPage({
	viewport: { width: 390, height: 844 },
	deviceScaleFactor: 2,
	isMobile: true,
	hasTouch: true,
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url);
await page.evaluate(() => {
	document.body.classList.add("is-phone", "is-mobile");
	// Obsidian defines this only on a phone; the navbar is ~48px plus inset.
	document.documentElement.style.setProperty("--view-bottom-spacing", "48px");
	// Repaint, because where the add box goes is decided at render time from
	// this very class. Painting before setting it would test the desktop layout
	// under a phone viewport, which is nobody's configuration.
	window.paint();
});
await page.waitForTimeout(200);

const PANE = "#drag";
await page.$eval(PANE, (el) => el.scrollIntoView({ block: "center" }));
await page.waitForTimeout(100);

const INPUT = `${PANE} .lv-add-input`;

/* ------------------------------------------------------------------
   1. Typing must not come out reversed
   ------------------------------------------------------------------ */

await page.click(INPUT);
await page.waitForTimeout(120);
check("the add box takes focus", await page.$eval(INPUT, (e) => e === document.activeElement));

// One character at a time, as a person types — the reported symptom only shows
// up across several keystrokes.
await page.type(INPUT, "Cat", { delay: 60 });
await page.waitForTimeout(120);
const typed = await page.$eval(INPUT, (e) => e.value);
check("characters land in the order they were typed", typed === "Cat", JSON.stringify(typed));

const caret = await page.$eval(INPUT, (e) => e.selectionStart);
check("the caret ends up after the text, not before it", caret === typed.length, `caret=${caret}`);

const stillFocused = await page.$eval(INPUT, (e) => e === document.activeElement);
check("focus survives typing", stillFocused);

/* ------------------------------------------------------------------
   2. Raising the keyboard must not blank the view
   ------------------------------------------------------------------ */

const visible = async (sel) =>
	page.$eval(sel, (e) => {
		const r = e.getBoundingClientRect();
		return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
	});

const rootBefore = await visible(`${PANE} .lv-root, ${PANE}`);
const addBefore = await visible(`${PANE} .lv-add`);
check("the add box is on screen before the keyboard", addBefore.h > 0, JSON.stringify(addBefore));

/*
 * The keyboard. The harness panels are not ListsViews, so the measurement that
 * normally runs in trackKeyboard is applied here directly — what is under test
 * is the layout's response to it, not the measuring.
 */
const KEYBOARD = 320;
await page.evaluate(
	({ pane, kb }) => {
		document.body.classList.add("is-phone", "is-mobile");
		document.documentElement.style.setProperty("--view-bottom-spacing", "48px");
		const root = document.querySelector(`${pane} .lv-root`);
		root.style.setProperty("--lv-keyboard-height", `${kb}px`);
		root.classList.add("is-keyboard-open");
	},
	{ pane: PANE, kb: KEYBOARD }
);
await page.waitForTimeout(150);

const scrolled = await page.evaluate(() => {
	// Any ancestor scrolled to reveal the focused field is the bug: an
	// overflow:hidden box can still be scrolled programmatically, and then its
	// contents sit above the fold with no way to scroll back.
	let n = document.activeElement, out = [];
	while (n && n !== document.body) {
		if (n.scrollTop > 0) out.push(`${n.className || n.tagName}:${n.scrollTop}`);
		n = n.parentElement;
	}
	return out;
});
check("no ancestor scrolled the view out of sight", scrolled.length === 0, scrolled.join(", "));

const clearance = await page.$eval(`${PANE} .lv-root`, (e) =>
	getComputedStyle(e).getPropertyValue("--lv-navbar-clearance").trim()
);
check(
	"the reserve is dropped, not raised, when the keyboard is up",
	// Obsidian shortens the app container by the keyboard's height and hides
	// the navbar, so by the time we lay out there is nothing left to clear.
	// Reserving anything here double-counts and pushes the content off screen.
	clearance === "0px" || clearance === "0",
	`clearance=${clearance || "(unset)"}`
);

/*
 * Where the add box lives, which is the whole answer to the keyboard.
 *
 * The webview slides the entire app upward when the keyboard rises — the
 * editor does it too, so it is the platform's and not ours. What made this
 * view worse than the editor was that the field being tapped sat in a bar
 * pinned *outside* every scroller, so nothing could bring it anywhere. On
 * touch it now sits at the end of the list, in the same scroller as the tasks,
 * exactly as typing in a note does.
 */
const inScroller = await page.$eval(
	`${PANE} .lv-add`,
	(e) => !!e.closest(".lv-scroll")
);
check("on touch the add box is inside the list's own scroller", inScroller);

const lastInList = await page.$eval(
	`${PANE} .lv-scroll`,
	(e) => e.lastElementChild?.classList.contains("lv-add") ?? false
);
check("and it is the last thing in it, after the tasks", lastInList);

const gap = await page.$eval(`${PANE} .lv-add`, (e) =>
	Math.round(parseFloat(getComputedStyle(e).paddingBottom))
);
check(
	"the box itself reserves nothing — the scroller carries it for the whole list",
	gap < 40,
	`padding-bottom=${gap}px`
);

const scrollerRoom = await page.$eval(`${PANE} .lv-scroll`, (e) =>
	Math.round(parseFloat(getComputedStyle(e).paddingBottom))
);
check(
	"and the scroller does carry it, so the box can be scrolled clear of the keyboard",
	scrollerRoom >= KEYBOARD,
	`padding-bottom=${scrollerRoom}px, keyboard=${KEYBOARD}px`
);

// And with the keyboard down that room goes back to clearing the navbar only.
await page.evaluate((pane) => {
	const root = document.querySelector(`${pane} .lv-root`);
	root.style.setProperty("--lv-keyboard-height", "0px");
	root.classList.remove("is-keyboard-open");
}, PANE);
await page.waitForTimeout(100);
const roomDown = await page.$eval(`${PANE} .lv-scroll`, (e) =>
	Math.round(parseFloat(getComputedStyle(e).paddingBottom))
);
check(
	"which it gives back when the keyboard closes",
	roomDown < KEYBOARD && roomDown > 0,
	`padding-bottom=${roomDown}px`
);

/* ------------------------------------------------------------------
   3. The + must commit, not just sit there

   A soft keyboard's return key is often "Next" rather than a submit, so
   on a phone the + is the only reliable way to add something — and it
   was a div with no handler on it at all.
   ------------------------------------------------------------------ */

const PLUS = `${PANE} .lv-add-icon`;
check("the + is a real button", await page.$eval(PLUS, (e) => e.getAttribute("role") === "button"));

await page.evaluate(() => (window.lvCalls.length = 0));
await page.click(INPUT);
await page.$eval(INPUT, (e) => (e.value = ""));
await page.type(INPUT, "Feed the cat", { delay: 20 });
await page.click(PLUS);
await page.waitForTimeout(120);
let added = await page.evaluate(() => window.lvCalls);
check(
	"tapping + adds the task",
	added.some((c) => c[0] === "addTask"),
	JSON.stringify(added.map((c) => c[0]))
);
check(
	"with the typed title",
	added.find((c) => c[0] === "addTask")?.[2] === "Feed the cat",
	JSON.stringify(added.find((c) => c[0] === "addTask")?.[2])
);
check("the field is cleared", (await page.$eval(INPUT, (e) => e.value)) === "");
check(
	"and keeps focus, so the next one can be typed straight away",
	await page.$eval(INPUT, (e) => e === document.activeElement)
);

await page.evaluate(() => (window.lvCalls.length = 0));
await page.click(PLUS);
await page.waitForTimeout(80);
added = await page.evaluate(() => window.lvCalls);
check(
	"tapping + with nothing typed adds nothing",
	!added.some((c) => c[0] === "addTask"),
	JSON.stringify(added.map((c) => c[0]))
);

check(
	"the return key is labelled as a submit, not Next",
	(await page.$eval(INPUT, (e) => e.getAttribute("enterkeyhint"))) === "done"
);

/* ------------------------------------------------------------------
   4. The detail panel with the keyboard up

   Tapping "add a step" pops the keyboard and the panel disappears.
   The add box was fixed for this; the overlay is a different subtree
   with its own scroller and was never tested with a keyboard.
   ------------------------------------------------------------------ */

const OVERLAY = "#m-detail .lv-overlay";
const STEP = `${OVERLAY} .lv-step-input`;

await page.evaluate(() => {
	document.body.classList.add("is-phone", "is-mobile");
	document.querySelector("#m-detail")?.scrollIntoView({ block: "center" });
});
await page.waitForTimeout(150);

const overlayBefore = await visible(OVERLAY);
check("the detail panel is on screen", overlayBefore.h > 0, JSON.stringify(overlayBefore));
check("it has a step field", (await page.$(STEP)) !== null);

const stepGapBefore = await page.$eval(`${OVERLAY} .lv-scroll`, (e) =>
	Math.round(parseFloat(getComputedStyle(e).paddingBottom))
);

await page.click(STEP);
await page.waitForTimeout(120);

// The keyboard: Android does not resize the webview, so nothing about the
// layout changes on its own — which is precisely why the panel has to reserve
// room rather than assume it was given some.
await page.evaluate(
	(kb) => {
		const root = document.querySelector("#m-detail .lv-root");
		root.style.setProperty("--lv-keyboard-height", `${kb}px`);
		root.classList.add("is-keyboard-open");
	},
	KEYBOARD
);
await page.waitForTimeout(200);

const overlayAfter = await visible(OVERLAY);
check(
	"the detail panel is still on screen with the keyboard up",
	overlayAfter.h > 0,
	JSON.stringify(overlayAfter)
);

const hidden = await page.evaluate((sel) => {
	const el = document.querySelector(sel);
	const cs = getComputedStyle(el);
	return {
		display: cs.display,
		visibility: cs.visibility,
		opacity: cs.opacity,
		transform: cs.transform,
	};
}, OVERLAY);
check(
	"and is not hidden, faded or translated away",
	hidden.display !== "none" &&
		hidden.visibility !== "hidden" &&
		Number(hidden.opacity) > 0 &&
		!/matrix\(1, 0, 0, 1, [1-9]/.test(hidden.transform),
	JSON.stringify(hidden)
);

const stepVisible = await visible(STEP);
check(
	"the step field the user tapped is still visible",
	stepVisible.h > 0,
	JSON.stringify(stepVisible)
);

const detailScrolled = await page.evaluate((sel) => {
	const out = [];
	let n = document.querySelector(sel);
	while (n && n !== document.body) {
		// A scroller that has been scrolled to reveal the field is fine; an
		// overflow:hidden box that has been is not — it cannot be scrolled back.
		const cs = getComputedStyle(n);
		if (n.scrollTop > 0 && cs.overflowY === "hidden") {
			out.push(`${n.className || n.tagName}:${n.scrollTop}`);
		}
		n = n.parentElement;
	}
	return out;
}, STEP);
check(
	"no unscrollable ancestor was scrolled to reveal it",
	detailScrolled.length === 0,
	detailScrolled.join(", ")
);

/*
 * Two things that look like the same thing and are not.
 *
 * Shortening the panel by the keyboard's height subtracts a second keyboard
 * from a pane Obsidian has already shortened, and that is what collapsed it to
 * nothing. Padding the *scroller inside* the panel cannot do that: padding at
 * the end of a scroll container only ever adds room to scroll into. So the
 * panel must not move, and the scroller must reserve.
 *
 * Obsidian does the second itself — `.vertical-tab-content` in its own settings
 * is `padding-bottom: max(var(--keyboard-height), var(--size-4-16))` — which is
 * what settled the argument after three wrong guesses in the other direction.
 */
check(
	"the panel itself is not lifted — that is what collapsed it before",
	overlayAfter.bottom === overlayBefore.bottom,
	`bottom ${overlayBefore.bottom} -> ${overlayAfter.bottom}`
);

const stepGap = await page.$eval(`${OVERLAY} .lv-scroll`, (e) =>
	Math.round(parseFloat(getComputedStyle(e).paddingBottom))
);
check(
	"but its scroller reserves room to scroll the field clear of the keyboard",
	stepGap >= KEYBOARD,
	`padding-bottom=${stepGap}px, keyboard=${KEYBOARD}px`
);

const stepScrollPad = await page.$eval(`${OVERLAY} .lv-scroll`, (e) =>
	Math.round(parseFloat(getComputedStyle(e).scrollPaddingBottom) || 0)
);
check(
	"and stops short of it when it scrolls the field into view",
	stepScrollPad >= KEYBOARD,
	`scroll-padding-bottom=${stepScrollPad}px`
);

// And gives it all back the moment the keyboard goes down, or every list would
// end with a screenful of nothing.
await page.evaluate(() => {
	const root = document.querySelector("#m-detail .lv-root");
	root.style.setProperty("--lv-keyboard-height", "0px");
	root.classList.remove("is-keyboard-open");
});
await page.waitForTimeout(100);
const stepGapDown = await page.$eval(`${OVERLAY} .lv-scroll`, (e) =>
	Math.round(parseFloat(getComputedStyle(e).paddingBottom))
);
check(
	"and takes it back when the keyboard closes",
	// Back to whatever it reserved before — the navbar's height on a phone, not
	// zero. Comparing against the baseline rather than a number keeps this from
	// re-stating the stylesheet.
	stepGapDown === stepGapBefore,
	`padding-bottom=${stepGapBefore}px -> ${stepGap}px -> ${stepGapDown}px`
);

void rootBefore;
void addBefore;
check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
