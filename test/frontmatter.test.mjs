import { test } from "node:test";
import assert from "node:assert/strict";
import { setFrontmatterKey, getFrontmatterKey, findFrontmatter, formatScalar } from "./model.mjs";

const nl = (a) => a.join("\n");

/* ------------------------------------------------------------------ *
 * The property that matters: only the targeted line ever changes.
 * ------------------------------------------------------------------ */

test("replacing a key leaves every other line byte-identical", () => {
	const before = nl(["---", "icon: 💼", "color: red", "sort: due", "---", "", "- [ ] a"]);
	const after = setFrontmatterKey(before, "color", "blue");
	const b = before.split("\n"), a = after.split("\n");
	assert.equal(a.length, b.length);
	for (let i = 0; i < b.length; i++) {
		if (i === 2) continue;
		assert.equal(a[i], b[i], `line ${i} drifted`);
	}
	assert.equal(a[2], "color: blue");
});

test("adding a key inserts before the closing fence and touches nothing else", () => {
	const before = nl(["---", "icon: 💼", "---", "", "- [ ] a"]);
	const after = setFrontmatterKey(before, "color", "teal");
	assert.equal(after, nl(["---", "icon: 💼", "color: teal", "---", "", "- [ ] a"]));
});

test("removing a key drops exactly that line", () => {
	const before = nl(["---", "icon: 💼", "color: red", "---", "", "- [ ] a"]);
	assert.equal(
		setFrontmatterKey(before, "color", null),
		nl(["---", "icon: 💼", "---", "", "- [ ] a"])
	);
});

test("a file with no frontmatter gets a block, body intact", () => {
	const before = nl(["- [ ] a", "- [ ] b"]);
	const after = setFrontmatterKey(before, "color", "red");
	assert.equal(after, nl(["---", "color: red", "---", "", "- [ ] a", "- [ ] b"]));
});

test("an empty file gets a clean block", () => {
	assert.equal(setFrontmatterKey("", "color", "red"), nl(["---", "color: red", "---", ""]));
});

test("writing the value it already has is a no-op, so no write happens", () => {
	const before = nl(["---", "color: red", "---", "", "- [ ] a"]);
	assert.equal(setFrontmatterKey(before, "color", "red"), before);
});

test("removing an absent key is a no-op", () => {
	const before = nl(["---", "icon: 💼", "---", "", "- [ ] a"]);
	assert.equal(setFrontmatterKey(before, "color", null), before);
});

/* ------------------------------------------------------------------ *
 * Other people's frontmatter must survive untouched.
 * ------------------------------------------------------------------ */

test("a Kanban board's frontmatter survives a colour write", () => {
	// This shape is real: the Kanban plugin reads its own key back out.
	const before = nl(["---", "", "kanban-plugin: board", "", "---", "", "## Monday", "", "- [ ] a"]);
	const after = setFrontmatterKey(before, "color", "red");
	assert.ok(after.includes("kanban-plugin: board"), "kanban key lost");
	assert.equal(getFrontmatterKey(after, "color"), "red");
	assert.equal(getFrontmatterKey(after, "kanban-plugin"), "board");
	// The blank lines inside their block are theirs; we did not reflow them.
	assert.ok(after.includes("---\n\nkanban-plugin: board\n\ncolor: red\n---"));
});

test("nested and list values are not mistaken for the key", () => {
	const before = nl([
		"---",
		"tags:",
		"  - task",
		"  - color",      // indented — not a top-level key
		"status: none",
		"---",
		"",
		"- [ ] a",
	]);
	const after = setFrontmatterKey(before, "color", "red");
	assert.ok(after.includes("  - color"), "nested list item was clobbered");
	assert.equal(getFrontmatterKey(after, "color"), "red");
	assert.equal(getFrontmatterKey(after, "status"), "none");
});

test("a key that is a prefix of another is not confused with it", () => {
	const before = nl(["---", "colorScheme: dark", "---", "", "- [ ] a"]);
	const after = setFrontmatterKey(before, "color", "red");
	assert.equal(getFrontmatterKey(after, "colorScheme"), "dark");
	assert.equal(getFrontmatterKey(after, "color"), "red");
});

test("a --- later in the body is a horizontal rule, not frontmatter", () => {
	const before = nl(["- [ ] a", "", "---", "", "- [ ] b"]);
	const after = setFrontmatterKey(before, "color", "red");
	assert.ok(after.startsWith("---\ncolor: red\n---"), "did not create its own block");
	// The rule is still in the body.
	assert.equal(after.split("---").length - 1, 3);
});

test("an unterminated opening fence is treated as content, not a block", () => {
	const before = nl(["---", "icon: 💼", "", "- [ ] a"]);
	assert.equal(findFrontmatter(before.split("\n")), null);
});

test("CRLF files stay CRLF", () => {
	const before = "---\r\nicon: 💼\r\n---\r\n\r\n- [ ] a\r\n";
	const after = setFrontmatterKey(before, "color", "red");
	assert.ok(after.includes("\r\n"), "line endings converted");
	assert.ok(!/[^\r]\n/.test(after), "mixed line endings introduced");
	assert.equal(getFrontmatterKey(after, "color"), "red");
});

/* ------------------------------------------------------------------ *
 * Values YAML would otherwise misread
 * ------------------------------------------------------------------ */

test("emoji and plain words stay unquoted", () => {
	assert.equal(formatScalar("💼"), "💼");
	assert.equal(formatScalar("red"), "red");
	assert.equal(formatScalar("#e5534b"), '"#e5534b"'); // # would start a comment
});

test("values YAML would read as something else get quoted", () => {
	for (const v of ["true", "no", "null", "~", "1.2", "007", "- x", "a: b", "", " x"]) {
		const out = setFrontmatterKey("", "k", v);
		assert.equal(getFrontmatterKey(out, "k"), v, `round-trip failed for ${JSON.stringify(v)}`);
	}
});

test("every value round-trips through write then read", () => {
	for (const v of ["red", "💼", "Work To-Dos", "#ff0000", "cards", "a b c"]) {
		const out = setFrontmatterKey(nl(["---", "icon: x", "---", "", "- [ ] a"]), "k", v);
		assert.equal(getFrontmatterKey(out, "k"), v);
	}
});

test("repeated writes converge instead of stacking duplicates", () => {
	let s = nl(["---", "icon: 💼", "---", "", "- [ ] a"]);
	for (const c of ["red", "blue", "green", "green"]) s = setFrontmatterKey(s, "color", c);
	assert.equal((s.match(/^color:/gm) || []).length, 1, "duplicate color keys");
	assert.equal(getFrontmatterKey(s, "color"), "green");
});
