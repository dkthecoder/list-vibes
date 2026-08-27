/**
 * Drive renaming in a real browser.
 *
 * A picker row is a button whose label is also a text field, and the two roles
 * fight: a click that should open a list must not land in the field, and a click
 * that should place a caret must not open a list. That conflict only exists as
 * event handling, so it is checked by sending events.
 */
import { launch } from "./browser.mjs";

const url = "file://" + process.cwd() + "/harness/index.html";
const browser = await launch();

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

const PANE = "#drag";
await page.$eval(PANE, (el) => el.scrollIntoView({ block: "center" }));
await page.waitForTimeout(100);

/* Lists come after the smart views and a divider; take the last row in the
   list group, which is a real list rather than My Day or Planned. */
const ROW = `${PANE} .lv-nav-group:last-of-type .lv-nav-row:last-child`;
const LABEL = `${ROW} .lv-nav-label`;

const name0 = await page.$eval(LABEL, (e) => e.textContent.trim());
check("a list row is found", !!name0, name0);

const editable = async () =>
	page.$eval(LABEL, (e) => e.getAttribute("contenteditable"));

check("the label is not a field at rest", (await editable()) === "false");

/* ---- a single click opens the list, it does not start editing ---- */
await page.evaluate(() => (window.lvCalls.length = 0));
await page.click(ROW);
await page.waitForTimeout(50);
check("a single click still opens the list", (await editable()) === "false");

/* ---- double-click arms the field ---- */
await page.dblclick(LABEL);
await page.waitForTimeout(50);
check("double-click makes the label a field", (await editable()) === "plaintext-only");
check(
	"the row is marked as renaming",
	await page.$eval(ROW, (e) => e.classList.contains("is-renaming"))
);
check(
	"the whole name is selected, so typing replaces it",
	await page.evaluate(() => (window.getSelection()?.toString() ?? "").length > 0),
	await page.evaluate(() => window.getSelection()?.toString())
);
check(
	"the count and ⋯ button step out of the field's way",
	await page.$eval(ROW, (e) => {
		const more = e.querySelector(".lv-nav-more");
		return !more || getComputedStyle(more).display === "none";
	})
);

/* ---- a click inside the field must not open the list ---- */
await page.evaluate(() => (window.lvCalls.length = 0));
await page.click(LABEL);
await page.waitForTimeout(50);
let calls = await page.evaluate(() => window.lvCalls);
check(
	"clicking inside the field does not open the list",
	(await editable()) === "plaintext-only",
	JSON.stringify(calls.map((c) => c[0]))
);

/* ---- Escape reverts and disarms ---- */
await page.keyboard.press("Escape");
await page.waitForTimeout(50);
check("Escape puts the name back", (await page.$eval(LABEL, (e) => e.textContent.trim())) === name0);
check("Escape disarms the field", (await editable()) === "false");
check(
	"and clears the renaming state",
	!(await page.$eval(ROW, (e) => e.classList.contains("is-renaming")))
);

/* The two refusal cases come first: a successful rename leaves the label
   showing its new text, and the harness stub does not actually rename the file,
   so anything after it would be comparing against a stale original. */

/* ---- an unchanged name writes nothing ---- */
await page.evaluate(() => (window.lvCalls.length = 0));
await page.dblclick(LABEL);
await page.keyboard.press("Enter");
await page.waitForTimeout(50);
calls = await page.evaluate(() => window.lvCalls);
check(
	"committing an unchanged name writes nothing",
	!calls.some((c) => c[0] === "renameList"),
	JSON.stringify(calls.map((c) => c[0]))
);

/* ---- an empty name is refused, not written ---- */
await page.evaluate(() => (window.lvCalls.length = 0));
await page.dblclick(LABEL);
await page.keyboard.press("Delete");
await page.keyboard.press("Enter");
await page.waitForTimeout(50);
calls = await page.evaluate(() => window.lvCalls);
check(
	"an empty name is refused — it would be an unopenable file",
	!calls.some((c) => c[0] === "renameList"),
	JSON.stringify(calls.map((c) => c[0]))
);
const after = await page.$eval(LABEL, (e) => e.textContent.trim());
check("and the original name is restored", after.length > 0, after);

/* ---- typing a new name and pressing Enter commits ---- */
await page.evaluate(() => (window.lvCalls.length = 0));
await page.dblclick(LABEL);
await page.keyboard.type("Renamed by test");
await page.keyboard.press("Enter");
await page.waitForTimeout(50);
calls = await page.evaluate(() => window.lvCalls);
const renamed = calls.find((c) => c[0] === "renameList");
check("Enter commits the rename", !!renamed, JSON.stringify(calls.map((c) => c[0])));
check(
	"with the typed name",
	renamed && renamed[2] === "Renamed by test",
	JSON.stringify(renamed?.[2])
);
check("and the field is disarmed again", (await editable()) === "false");

/* ---- the header name in a list pane is editable at rest ---- */
const HEADER = `${PANE} .lv-header-name`;
check(
	"the list header name is a field at rest",
	(await page.$eval(HEADER, (e) => e.getAttribute("contenteditable"))) ===
		"plaintext-only"
);

/* ------------------------------------------------------------------
   A tidied title must never rename the file by itself

   The title shows a list's name with separators as spaces —
   `weekly_review` reads as `weekly review`. It is also the field that
   renames the file when it is committed. Those two facts together are a
   trap: if the tidied text were what sat in the field when it took
   focus, opening a list and touching its title would quietly rename the
   file to the tidied version.

   So the field shows the tidy version at rest and the *true* name the
   moment it is focused. What you edit is always what will be written.
   ------------------------------------------------------------------ */

const tidy = await page.evaluate(() => {
	const host = document.body.appendChild(document.createElement("div"));
	host.id = "tidy-probe";
	const el = host.appendChild(document.createElement("span"));
	// On window, not in a closure, so a later step can read what was committed.
	window.lvTidyWrites = [];
	window.lvMakeEditableName(el, {
		value: "weekly_review",
		display: "weekly review",
		alwaysEditable: true,
		onCommit: (next) => window.lvTidyWrites.push(next),
	});
	const atRest = el.textContent;

	el.focus();
	const onFocus = el.textContent;

	// Blur without touching anything: an unchanged name must write nothing and
	// go back to reading tidily.
	el.blur();
	return { atRest, onFocus, afterBlur: el.textContent, written: window.lvTidyWrites.slice() };
});

check("the title reads tidily at rest", tidy.atRest === "weekly review", tidy.atRest);
check(
	"and swaps to the real filename the moment it is focused",
	tidy.onFocus === "weekly_review",
	tidy.onFocus
);
check(
	"so clicking in and out renames nothing",
	tidy.written.length === 0,
	JSON.stringify(tidy.written)
);
check(
	"and it goes back to reading tidily afterwards",
	tidy.afterBlur === "weekly review",
	tidy.afterBlur
);

// And a real edit still writes exactly what was typed — separators and all,
// rather than the tidied reading of it.
const edited = await page.evaluate(() => {
	const el = document.querySelector("#tidy-probe span");
	el.focus();
	el.textContent = "spring_cleaning";
	el.blur();
	return window.lvTidyWrites.slice();
});
check(
	"a real edit is written verbatim, underscores included",
	edited.length === 1 && edited[0] === "spring_cleaning",
	JSON.stringify(edited)
);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
