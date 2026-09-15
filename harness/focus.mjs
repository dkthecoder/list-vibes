/**
 * What counts as "the user is typing", and what does not.
 *
 * A repaint is held back while a field has focus, because replacing a focused
 * input breaks an IME composition mid-word. The predicate deciding that used to
 * ask whether the element was an `<input>` with a non-empty value — and a
 * checkbox is an `<input>` whose value is the string "on" whether ticked or
 * not. So ticking a task held back the repaint that would move it into
 * Completed, until focus happened to move: the row sat in the open list, and a
 * second click ran against a line the file no longer had, so the box unticked
 * itself and the task dropped into Completed anyway.
 */
import { launch } from "./browser.mjs";

const url = "file://" + process.cwd() + "/harness/index.html";
const browser = await launch();

const results = [];
const check = (name, pass, detail = "") => {
	results.push({ name, pass, detail });
	console.log(`${pass ? "  ok  " : "  FAIL"} ${name}${detail ? "  — " + detail : ""}`);
};

const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForTimeout(200);

const verdicts = await page.evaluate(() => {
	const ask = (make) => {
		const el = make();
		document.body.appendChild(el);
		const answer = window.isTextEntry(el);
		el.remove();
		return answer;
	};
	const input = (type, value = "") => () => {
		const el = document.createElement("input");
		el.type = type;
		if (value) el.value = value;
		return el;
	};
	return {
		checkbox: ask(input("checkbox")),
		radio: ask(input("radio")),
		button: ask(input("button")),
		range: ask(input("range")),
		emptyText: ask(input("text")),
		typedText: ask(input("text", "half a wor")),
		typedSearch: ask(input("search", "q")),
		textarea: ask(() => {
			const el = document.createElement("textarea");
			el.value = "a note";
			return el;
		}),
		editable: ask(() => {
			const el = document.createElement("div");
			el.contentEditable = "true";
			return el;
		}),
		plainDiv: ask(() => document.createElement("div")),
		nothing: window.isTextEntry(null),
	};
});

check(
	"a checkbox is not typing, whatever its value says",
	verdicts.checkbox === false,
	`checkbox=${verdicts.checkbox}`
);
check(
	"nor are the other non-text inputs",
	verdicts.radio === false && verdicts.button === false && verdicts.range === false,
	`radio=${verdicts.radio} button=${verdicts.button} range=${verdicts.range}`
);
check(
	"a half-typed field is",
	verdicts.typedText === true && verdicts.typedSearch === true && verdicts.textarea === true,
	`text=${verdicts.typedText} search=${verdicts.typedSearch} textarea=${verdicts.textarea}`
);
check(
	"an empty one is not — it has nothing to lose, and that is the state right after it commits",
	verdicts.emptyText === false,
	`emptyText=${verdicts.emptyText}`
);
check(
	"an editable element is, and a plain one is not",
	verdicts.editable === true && verdicts.plainDiv === false,
	`editable=${verdicts.editable} div=${verdicts.plainDiv}`
);
check("and nothing focused is not typing", verdicts.nothing === false);

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
