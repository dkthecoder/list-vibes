import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
	rulesMentioning,
	viewportGap,
	explain,
	formatReport,
} from "./build/diagnostics.js";

/**
 * Reading the rules instead of remembering them.
 *
 * Everything written about this fault so far has been reasoned from a rule
 * quoted from memory. This is the code that goes and looks.
 */
const sheet = (name, ...texts) => ({
	href: `https://app/${name}`,
	get cssRules() {
		return texts.map((t) => ({
			cssText: t,
			selectorText: t.split("{")[0].trim(),
		}));
	},
});

const CORE = "body.is-mobile .app-container { max-height: calc(100vh - var(--keyboard-height)); }";

describe("rulesMentioning", () => {
	test("finds the rule everyone has been quoting", () => {
		const found = rulesMentioning([sheet("app.css", CORE, ".x { color: red; }")], "keyboard-height");
		assert.equal(found.length, 1);
		assert.equal(found[0].sheet, "app.css");
		assert.equal(found[0].text, CORE);
	});

	test("and reports nothing when the rule is not there", () => {
		// The finding that would overturn the whole diagnosis, so it must be
		// distinguishable from a failure to look.
		assert.deepEqual(rulesMentioning([sheet("app.css", ".x { color: red; }")], "keyboard-height"), []);
	});

	test("a sheet that refuses to be read does not lose the others", () => {
		const locked = {
			href: "https://cdn/other.css",
			get cssRules() {
				throw new Error("SecurityError");
			},
		};
		const found = rulesMentioning([locked, sheet("app.css", CORE)], "keyboard-height");
		assert.equal(found.length, 2);
		assert.equal(found[0].selector, "(unreadable)");
		assert.equal(found[1].text, CORE);
	});

	test("and the search is bounded", () => {
		const many = sheet("big", ...Array.from({ length: 100 }, () => CORE));
		assert.equal(rulesMentioning([many], "keyboard-height", 5).length, 5);
	});
});

const sample = (o) => ({
	at: "t",
	innerHeight: 2000,
	clientHeight: 2000,
	vh: 2000,
	dvh: 2000,
	visual: 2000,
	offsetTop: 0,
	scale: 1,
	keyboardVar: 0,
	appHeight: 2000,
	appMaxHeight: "none",
	shortened: [],
	bodyClass: "is-mobile is-tablet",
	...o,
});

const KEYBOARD = 645;

describe("explain", () => {
	test("the window resized and nothing else — subtracting again is the bug", () => {
		const rest = sample({});
		const typing = sample({ innerHeight: 2000 - KEYBOARD, visual: 2000 - KEYBOARD });
		assert.match(explain(rest, typing), /already accounted for/);
	});

	test("the visual viewport resized and the window did not — the ordinary case", () => {
		const rest = sample({});
		const typing = sample({ visual: 2000 - KEYBOARD });
		assert.match(explain(rest, typing), /subtracting it once is correct/);
	});

	test("both — the double count, and no stylesheet in it", () => {
		// The window shrinks to 1355 and the visual viewport to 710 inside it.
		const rest = sample({});
		const typing = sample({ innerHeight: 1355, visual: 710 });
		assert.match(explain(rest, typing), /counted twice/);
		assert.match(explain(rest, typing), /no stylesheet is involved/);
	});

	test("and neither, which means the page is never told", () => {
		assert.match(explain(sample({}), sample({})), /not being reported to the page/);
	});

	test("a suggestion strip is not a keyboard", () => {
		// Tens of pixels either way is chrome, not an IME. Without a floor this
		// would announce a diagnosis every time the toolbar changed height.
		const rest = sample({});
		const typing = sample({ innerHeight: 1960, visual: 1960 });
		assert.match(explain(rest, typing), /not being reported to the page/);
	});
});

describe("viewportGap", () => {
	test("is what the window has that the visible part does not", () => {
		assert.equal(viewportGap({ innerHeight: 1355, visual: 710 }), 645);
	});
});

describe("formatReport", () => {
	test("says plainly when no rule mentions the keyboard at all", () => {
		const body = formatReport([], [], [sample({})]);
		assert.match(body, /\*\*None\.\*\*/);
		assert.match(body, /aimed at a rule that does not exist/);
	});

	test("and carries every sample as a row", () => {
		const body = formatReport([], [], [sample({ at: "t0" }), sample({ at: "t1" })]);
		assert.match(body, /\| t0 \|/);
		assert.match(body, /\| t1 \|/);
	});

	test("and never lets a value break the table", () => {
		// A selector or a class list containing a pipe would silently corrupt
		// every column after it, which is how a report gets quietly misread.
		const body = formatReport([], [], [sample({ bodyClass: "a|b" })]);
		const row = body.split("\n").find((l) => l.startsWith("| t "));
		assert.equal(row.split("|").length, 16);
	});

	test("and asks for more when it has only one side of the story", () => {
		assert.match(formatReport([], [], [sample({})]), /Not enough samples/);
	});
});
