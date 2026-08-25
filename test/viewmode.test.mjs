import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeViewMode, parseFile } from "./model.mjs";

/**
 * The post-it wall shipped first as "cards". That name is on disk in real
 * vaults — in list frontmatter, which belongs to the user and is not ours to
 * rewrite — so it has to keep working forever, not just across one migration.
 * These tests exist to stop a future tidy-up from deleting the alias.
 */

test("normalizeViewMode", async (t) => {
	await t.test("accepts the current names", () => {
		assert.equal(normalizeViewMode("list"), "list");
		assert.equal(normalizeViewMode("postit"), "postit");
	});

	await t.test("accepts the legacy name for the post-it wall", () => {
		assert.equal(normalizeViewMode("cards"), "postit");
	});

	await t.test("returns undefined for anything else, rather than guessing", () => {
		for (const v of ["", "grid", "board", "List", "POSTIT", "kanban"]) {
			assert.equal(normalizeViewMode(v), undefined, `for ${JSON.stringify(v)}`);
		}
	});

	await t.test("survives values that are not strings at all", () => {
		for (const v of [undefined, null, 0, 1, true, {}, [], NaN]) {
			assert.equal(normalizeViewMode(v), undefined, `for ${String(v)}`);
		}
	});
});

test("a list's layout is read from its frontmatter", async (t) => {
	const withView = (value) =>
		parseFile(`---\nview: ${value}\n---\n\n- [ ] A\n`, "lists/L.md").config.view;

	await t.test("the current name", () => {
		assert.equal(withView("postit"), "postit");
		assert.equal(withView("list"), "list");
	});

	await t.test("a file written by an older version still opens as post-it", () => {
		assert.equal(withView("cards"), "postit");
	});

	await t.test("an unknown value leaves the list on the default", () => {
		assert.equal(withView("wall"), undefined);
	});

	await t.test("no view key at all leaves it on the default", () => {
		assert.equal(parseFile("- [ ] A\n", "lists/L.md").config.view, undefined);
	});
});

test("reading a legacy layout never rewrites the file", () => {
	// The whole reason the alias is permanent rather than a migration: parsing
	// a list must not be a write. Reconstructing the file from the parse has to
	// give back the same bytes, `view: cards` included.
	const src = "---\nicon: 💼\nview: cards\ncolor: teal\n---\n\n- [ ] A\n- [x] B\n";
	const list = parseFile(src, "lists/L.md");
	assert.equal(list.config.view, "postit");
	const lines = src.split("\n");
	for (const task of list.all) {
		assert.equal(lines[task.line], task.raw, `line ${task.line} drifted`);
	}
	assert.equal(lines[2], "view: cards");
});
