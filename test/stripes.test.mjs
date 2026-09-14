import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFile } from "./model.mjs";

/**
 * `stripes` is tri-state on purpose: true, false, and absent.
 *
 * Absent means "whatever the setting says", which is what lets the settings
 * toggle restyle every list that has not chosen for itself. A parser that
 * defaulted it to false would pin every existing list to off the moment this
 * shipped, and the setting would appear not to work.
 */
const withFrontmatter = (body) => `---\n${body}\n---\n\n- [ ] a task\n`;

test("stripes in list frontmatter", async (t) => {
	await t.test("reads true and false", () => {
		assert.equal(parseFile(withFrontmatter("stripes: true"), "l.md").config.stripes, true);
		assert.equal(parseFile(withFrontmatter("stripes: false"), "l.md").config.stripes, false);
	});

	await t.test("is absent when the list does not mention it", () => {
		const cfg = parseFile(withFrontmatter("icon: 📋"), "l.md").config;
		assert.equal("stripes" in cfg, false, "absent, not false — false would pin it off");
	});

	await t.test("is absent for anything that is not true or false", () => {
		for (const v of ["yes", "no", "1", "0", "on", "TRUE", "maybe"]) {
			const cfg = parseFile(withFrontmatter(`stripes: ${v}`), "l.md").config;
			assert.equal(cfg.stripes, undefined, `for ${JSON.stringify(v)}`);
		}
	});

	await t.test("survives quotes, which is how some editors write YAML", () => {
		assert.equal(parseFile(withFrontmatter('stripes: "true"'), "l.md").config.stripes, true);
	});

	await t.test("does not disturb the rest of the config", () => {
		const cfg = parseFile(withFrontmatter("icon: 📋\nstripes: false\nsort: due"), "l.md").config;
		assert.equal(cfg.icon, "📋");
		assert.equal(cfg.stripes, false);
		assert.equal(cfg.sort, "due");
	});
});
