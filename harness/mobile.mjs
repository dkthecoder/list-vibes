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
		const root = document.querySelector(pane);
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

const clearance = await page.$eval(`${PANE}`, (e) =>
	getComputedStyle(e).getPropertyValue("--lv-navbar-clearance").trim()
);
check(
	"the reserve becomes the keyboard's height, not the navbar's",
	clearance.includes("keyboard") || clearance === `${KEYBOARD}px`,
	`clearance=${clearance || "(unset)"}`
);

const gap = await page.$eval(`${PANE} .lv-add`, (e) => {
	const cs = getComputedStyle(e);
	return Math.round(parseFloat(cs.paddingBottom));
});
check(
	"the add box reserves room to clear the keyboard",
	gap >= KEYBOARD,
	`padding-bottom=${gap}px, keyboard=${KEYBOARD}px`
);

// And with the keyboard down it goes back to clearing the navbar only.
await page.evaluate((pane) => {
	const root = document.querySelector(pane);
	root.classList.remove("is-keyboard-open");
}, PANE);
await page.waitForTimeout(100);
const gapDown = await page.$eval(`${PANE} .lv-add`, (e) =>
	Math.round(parseFloat(getComputedStyle(e).paddingBottom))
);
check(
	"and gives that room back when the keyboard closes",
	gapDown < KEYBOARD && gapDown > 0,
	`padding-bottom=${gapDown}px`
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

void rootBefore;
void addBefore;
check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
