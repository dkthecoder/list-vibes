import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseInline } from "./build/ui/inline.js";

/**
 * What a task's title is allowed to contain, and where each thing starts.
 *
 * These were written to pin the behaviour down before the two lookbehinds came
 * out of the pattern — lookbehind is unsupported on iOS before 16.4, so every
 * task title on an older iPad was one regex away from not rendering at all.
 * The boundary rules they enforced are the whole point of this file: a `#` in
 * the middle of a word is not a tag, and a URL inside a longer token is not a
 * link. So they are asserted here rather than trusted to a feature the platform
 * may not have.
 */
const kinds = (s) => parseInline(s).map((p) => p.t).join(" ");
const first = (s, t) => parseInline(s).find((p) => p.t === t);

describe("parseInline", () => {
	test("plain text is one piece", () => {
		assert.deepEqual(parseInline("just words"), [{ t: "text", v: "just words" }]);
	});

	test("code, bold, italic and strike", () => {
		assert.equal(first("a `x` b", "code").v, "x");
		assert.equal(first("a **x** b", "bold").v, "x");
		assert.equal(first("a *x* b", "italic").v, "x");
		assert.equal(first("a ~~x~~ b", "strike").v, "x");
	});

	test("a wiki link, with and without a label", () => {
		assert.deepEqual(first("see [[Note]]", "wiki"), {
			t: "wiki",
			target: "Note",
			label: "Note",
		});
		assert.deepEqual(first("see [[Note|the note]]", "wiki"), {
			t: "wiki",
			target: "Note",
			label: "the note",
		});
	});

	test("a markdown link keeps its label", () => {
		assert.deepEqual(first("[docs](https://x.dev)", "link"), {
			t: "link",
			label: "docs",
			href: "https://x.dev",
		});
	});

	test("a bare url becomes a link labelled with itself", () => {
		assert.deepEqual(first("see https://x.dev now", "link"), {
			t: "link",
			label: "https://x.dev",
			href: "https://x.dev",
		});
	});

	test("but not one buried inside a longer token", () => {
		// `nothttps://x.dev` is not a link, and treating it as one would swallow
		// the word in front of it.
		assert.equal(kinds("nothttps://x.dev"), "text");
		assert.equal(parseInline("nothttps://x.dev")[0].v, "nothttps://x.dev");
	});

	test("a tag at the start of the text, and after a space", () => {
		assert.equal(first("#work", "tag").v, "#work");
		assert.equal(first("do it #work", "tag").v, "#work");
	});

	test("but a hash inside a word is not a tag", () => {
		// "issue#12" is a reference, not a tag, and the difference is only the
		// character in front of it.
		assert.equal(kinds("issue#12"), "text");
		assert.equal(parseInline("issue#12")[0].v, "issue#12");
	});

	test("text around a match survives on both sides", () => {
		assert.deepEqual(parseInline("a `x` b"), [
			{ t: "text", v: "a " },
			{ t: "code", v: "x" },
			{ t: "text", v: " b" },
		]);
	});

	test("several matches in one line, in order", () => {
		assert.equal(
			kinds("**a** and `b` and https://x.dev and #c"),
			"bold text code text link text tag"
		);
	});

	test("and the pieces always reassemble into the original", () => {
		// The property that matters most: whatever the parser decides, nothing
		// is dropped and nothing is invented. A title that loses a character on
		// its way to the screen is worse than one that renders no formatting.
		for (const s of [
			"a `x` b",
			"nothttps://x.dev",
			"issue#12 and #real",
			"[docs](https://x.dev) trailing",
			"see [[Note|the note]] end",
			"**a** and `b` and https://x.dev and #c",
			"",
			"#",
		]) {
			const back = parseInline(s)
				.map((p) =>
					p.t === "text" ? p.v
					: p.t === "code" ? "`" + p.v + "`"
					: p.t === "bold" ? "**" + p.v + "**"
					: p.t === "italic" ? "*" + p.v + "*"
					: p.t === "strike" ? "~~" + p.v + "~~"
					: p.t === "tag" ? p.v
					: p.t === "wiki"
						? "[[" + p.target + (p.label !== p.target ? "|" + p.label : "") + "]]"
					: p.label === p.href ? p.href
					: "[" + p.label + "](" + p.href + ")"
				)
				.join("");
			assert.equal(back, s, `round trip: ${JSON.stringify(s)}`);
		}
	});
});

/**
 * URLs with parentheses of their own.
 *
 * Markdown's rule is that parens inside a link destination must be balanced,
 * and Wikipedia's disambiguators — `She_(TV_series)` — are the everyday case.
 * Scanning to the first `)` ends the destination early and leaves the real
 * closing paren behind as text, which is how a list of shows ended up reading
 * "She⧉) 2020".
 */
describe("links whose URL contains parentheses", () => {
	test("a balanced pair inside the URL is part of the URL", () => {
		const [link] = parseInline("[She](https://en.wikipedia.org/wiki/She_(TV_series))");
		assert.equal(link.t, "link");
		assert.equal(link.href, "https://en.wikipedia.org/wiki/She_(TV_series)");
		assert.equal(link.label, "She");
	});

	test("nothing leaks out after the link", () => {
		const parts = parseInline("[She](https://x.dev/a_(b)) 2020");
		assert.equal(parts.length, 2);
		assert.equal(parts[1].t, "text");
		assert.equal(parts[1].v, " 2020");
	});

	test("a plain URL is unaffected", () => {
		const [link] = parseInline("[Salakaar](https://m.imdb.com/title/tt35077054/)");
		assert.equal(link.href, "https://m.imdb.com/title/tt35077054/");
	});

	test("parentheses at the end of the path still close the link", () => {
		const parts = parseInline("[Woh](https://en.wikipedia.org/wiki/Pati_(2019_film)) 2019 #film");
		assert.equal(parts[0].href, "https://en.wikipedia.org/wiki/Pati_(2019_film)");
		assert.equal(parts.some((p) => p.t === "tag" && p.v === "#film"), true);
	});

	test("an unbalanced paren does not swallow the rest of the line", () => {
		const parts = parseInline("[a](https://x.dev/b) c) d");
		assert.equal(parts[0].href, "https://x.dev/b");
		assert.equal(parts[1].v, " c) d");
	});
});
