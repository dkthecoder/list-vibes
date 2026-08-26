import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
	parseFile,
	parseLine,
	setStatusChar,
	setStatus,
	setField,
	setFields,
	setTitle,
	newTaskLine,
} from "./model.mjs";

/**
 * Fixtures live in test/fixtures and reproduce the structures found in real
 * vaults: heading-grouped lists with links and tags, kanban frontmatter with a
 * fenced code block, markdown tables, plain bullets, a frontmatter-only note,
 * mixed metadata dialects, custom status characters, and CRLF endings.
 *
 * To run the same suite against your own vault instead:
 *   LISTS_TEST_VAULT="/path/to/lists" npm test
 */
const VAULT =
	process.env.LISTS_TEST_VAULT ??
	path.join(import.meta.dirname, "fixtures");

const files = fs
	.readdirSync(VAULT)
	.filter((f) => f.endsWith(".md"))
	.map((f) => ({ name: f, content: fs.readFileSync(path.join(VAULT, f), "utf8") }));

test("fixture files loaded", () => {
	assert.ok(files.length > 0, `no markdown files found in ${VAULT}`);
});

/* ------------------------------------------------------------------ *
 * The critical property: reconstructing a file from parsed tasks,
 * changing nothing, must produce the original bytes exactly.
 * ------------------------------------------------------------------ */

for (const { name, content } of files) {
	test(`byte-identical reconstruction: ${name}`, () => {
		const list = parseFile(content, name);
		const lines = content.split("\n");
		for (const t of list.all) {
			// Rewrite each task line through the edit path with no actual change.
			lines[t.line] = setStatusChar(t, t.statusChar);
		}
		assert.equal(lines.join("\n"), content);
	});

	test(`offsets are exact: ${name}`, () => {
		const list = parseFile(content, name);
		for (const t of list.all) {
			assert.equal(t.raw[t.statusOffset], t.statusChar, `status offset on line ${t.line}`);
			for (const tok of t.tokens) {
				assert.equal(
					t.raw.slice(tok.start, tok.end).trim().length > 0,
					true,
					`empty token range on line ${t.line}`
				);
			}
		}
	});

	test(`toggle is reversible: ${name}`, () => {
		const list = parseFile(content, name);
		for (const t of list.all) {
			const flipped = setStatus(t, t.status === "done" ? "todo" : "done");
			const reparsed = parseLine(flipped, t.line, name);
			assert.ok(reparsed, `line ${t.line} stopped being a task after toggle`);
			const back = setStatusChar(reparsed, t.statusChar);
			assert.equal(back, t.raw, `line ${t.line} did not survive a round trip`);
		}
	});

	test(`title survives reparse: ${name}`, () => {
		const list = parseFile(content, name);
		for (const t of list.all) {
			const rewritten = setTitle(t, t.title);
			const reparsed = parseLine(rewritten, t.line, name);
			assert.ok(reparsed);
			assert.equal(reparsed.title, t.title, `line ${t.line}`);
			// Metadata must be untouched by a title edit.
			assert.deepEqual(reparsed.meta.due, t.meta.due);
			assert.deepEqual(reparsed.meta.done, t.meta.done);
		}
	});

	test(`add then remove a field restores the line: ${name}`, () => {
		const list = parseFile(content, name);
		for (const t of list.all) {
			if (t.meta.due) continue; // only test tasks that lack one
			const added = setField(t, "due", "2026-09-01", "emoji");
			const reparsed = parseLine(added, t.line, name);
			assert.ok(reparsed);
			assert.equal(reparsed.meta.due, "2026-09-01", `line ${t.line} due not read back`);
			const removed = setField(reparsed, "due", null, "emoji");
			assert.equal(removed, t.raw, `line ${t.line} not restored after removal`);
		}
	});

	test(`rewriting a field with its own value is a no-op: ${name}`, () => {
		const list = parseFile(content, name);
		for (const t of list.all) {
			for (const field of ["due", "done", "scheduled", "created"]) {
				if (!t.meta[field]) continue;
				const same = setField(t, field, t.meta[field], "emoji");
				assert.equal(same, t.raw, `line ${t.line} field ${field}`);
			}
		}
	});
}

/* ------------------------------------------------------------------ *
 * Parsing correctness on the real data
 * ------------------------------------------------------------------ */

test("Shows: structure and metadata", () => {
	const f = files.find((x) => x.name.includes("Shows"));
	if (!f) return;
	const list = parseFile(f.content, f.name);

	// Four ## sections in that file.
	const sections = [...new Set(list.all.map((t) => t.section))];
	assert.ok(sections.includes("US / English"), "US / English section missing");
	assert.ok(sections.includes("India / Hindi"), "India / Hindi section missing");

	// Every completed entry carries a ✅ date.
	const done = list.all.filter((t) => t.status === "done");
	assert.ok(done.length >= 3, `expected 3+ completed, got ${done.length}`);
	for (const d of done) {
		assert.match(d.meta.done ?? "", /^\d{4}-\d{2}-\d{2}$/, `${d.title} lacks a done date`);
	}

	// Tags are recorded, and left in the raw line.
	const tagged = list.all.filter((t) => t.meta.tags.length > 0);
	assert.ok(tagged.length >= 6, `expected tagged tasks, got ${tagged.length}`);
	assert.ok(tagged[0].raw.includes("#"), "tag was stripped from the raw line");

	// Markdown links stay intact in the title.
	const linked = list.all.find((t) => t.title.startsWith("[Landman]"));
	assert.ok(linked, "Landman not found");
	assert.ok(linked.title.includes("wikipedia.org"), "link URL lost from title");
});

test("Certifications: flat checkbox list with URLs", () => {
	const f = files.find((x) => x.name.includes("Certifications"));
	if (!f) return;
	const list = parseFile(f.content, f.name);
	assert.ok(list.all.length >= 14, `expected 14+ tasks, got ${list.all.length}`);
	assert.ok(list.all.every((t) => t.depth === 0), "unexpected nesting");
	assert.ok(list.all.every((t) => t.status === "todo"), "unexpected completion");
});

test("Timetable: kanban frontmatter is read, sections become days", () => {
	const f = files.find((x) => x.name.includes("Timetable"));
	if (!f) return;
	const list = parseFile(f.content, f.name);
	const sections = [...new Set(list.all.map((t) => t.section))];
	assert.ok(sections.includes("Monday"), "Monday section missing");
	assert.ok(sections.includes("Saturday"), "Saturday section missing");
	// The trailing ```json settings block must not be parsed as tasks.
	assert.ok(
		!list.all.some((t) => t.raw.includes("kanban-plugin")),
		"parsed inside a fenced code block"
	);
});

test("closes tracksheet: a markdown table yields no tasks", () => {
	const f = files.find((x) => x.name.includes("closes tracksheet"));
	if (!f) return;
	const list = parseFile(f.content, f.name);
	assert.equal(list.all.length, 0, "table rows were misread as tasks");
});

test("Travel criteria: plain bullets are not tasks", () => {
	const f = files.find((x) => x.name.includes("Travel criteria"));
	if (!f) return;
	const list = parseFile(f.content, f.name);
	assert.equal(list.all.length, 0, "plain bullets were misread as tasks");
});

test("Java SE 8 Programmer: frontmatter-only file yields no tasks", () => {
	const f = files.find((x) => x.name.includes("Java SE 8"));
	if (!f) return;
	const list = parseFile(f.content, f.name);
	assert.equal(list.all.length, 0);
});


/* ------------------------------------------------------------------ *
 * Synthetic cases: the full metadata surface
 * ------------------------------------------------------------------ */

test("emoji dialect: every field parses", () => {
	const raw =
		"- [ ] Write update to review ☀️ ⏰ 11:00 📅 2026-08-24 ⏳ 2026-08-20 🔺 🔁 every week ➕ 2021-01-08";
	const t = parseLine(raw, 0, "x.md");
	assert.equal(t.title, "Write update to review");
	assert.equal(t.meta.myDay, true);
	assert.equal(t.meta.reminder, "11:00");
	assert.equal(t.meta.due, "2026-08-24");
	assert.equal(t.meta.scheduled, "2026-08-20");
	assert.equal(t.meta.priority, "highest");
	assert.equal(t.meta.repeat, "every week");
	assert.equal(t.meta.created, "2021-01-08");
});

test("dataview dialect: every field parses", () => {
	const raw =
		"- [ ] Write update [myday:: true] [remind:: 11:00] [due:: 2026-08-24] [priority:: high] [repeat:: every week]";
	const t = parseLine(raw, 0, "x.md");
	assert.equal(t.title, "Write update");
	assert.equal(t.meta.myDay, true);
	assert.equal(t.meta.reminder, "11:00");
	assert.equal(t.meta.due, "2026-08-24");
	assert.equal(t.meta.priority, "high");
	assert.equal(t.meta.repeat, "every week");
});

test("mixed dialects in one line", () => {
	const t = parseLine("- [ ] Task 📅 2026-08-24 [priority:: low]", 0, "x.md");
	assert.equal(t.title, "Task");
	assert.equal(t.meta.due, "2026-08-24");
	assert.equal(t.meta.priority, "low");
});

test("editing a dataview field keeps dataview syntax", () => {
	const t = parseLine("- [ ] Task [due:: 2026-08-24]", 0, "x.md");
	const out = setField(t, "due", "2026-09-01", "emoji");
	assert.equal(out, "- [ ] Task [due:: 2026-09-01]", "dialect was not preserved in place");
});

test("emoji without a valid value stays in the title", () => {
	const t = parseLine("- [ ] Deploy on 📅 friday maybe", 0, "x.md");
	assert.equal(t.meta.due, undefined);
	assert.ok(t.title.includes("📅"), "bare marker was wrongly consumed");
});

test("variation selector is optional", () => {
	const withVs = parseLine("- [ ] A ☀️", 0, "x.md");
	const without = parseLine("- [ ] A ☀", 0, "x.md");
	assert.equal(withVs.meta.myDay, true);
	assert.equal(without.meta.myDay, true);
	assert.equal(withVs.title, "A");
	assert.equal(without.title, "A");
});

test("custom status characters are distinguishable", () => {
	assert.equal(parseLine("- [ ] a", 0, "x").status, "todo");
	assert.equal(parseLine("- [x] a", 0, "x").status, "done");
	assert.equal(parseLine("- [X] a", 0, "x").status, "done");
	assert.equal(parseLine("- [/] a", 0, "x").status, "inProgress");
	assert.equal(parseLine("- [-] a", 0, "x").status, "cancelled");
});

test("nesting: steps hang off their parent", () => {
	const md = [
		"- [ ] Write update",
		"\t- [x] take screenshots",
		"\t- [ ] crop and prep",
		"\t- [ ] check database",
		"- [ ] Next task",
	].join("\n");
	const list = parseFile(md, "x.md");
	assert.equal(list.tasks.length, 2, "expected 2 root tasks");
	assert.equal(list.tasks[0].children.length, 3, "expected 3 steps");
	assert.equal(list.tasks[0].children[0].depth, 1);
	assert.equal(list.tasks[0].children[0].parentLine, 0);
	const doneSteps = list.tasks[0].children.filter((c) => c.status === "done").length;
	assert.equal(doneSteps, 1, "the 0 of 3 counter would be wrong");
});

test("nesting works with spaces as well as tabs", () => {
	const md = ["- [ ] Parent", "    - [ ] Child", "        - [ ] Grandchild"].join("\n");
	const list = parseFile(md, "x.md");
	assert.equal(list.tasks.length, 1);
	assert.equal(list.tasks[0].children[0].depth, 1);
	assert.equal(list.tasks[0].children[0].children[0].depth, 2);
});

test("indented prose beneath a task becomes its note", () => {
	const md = ["- [ ] Write update 📅 2026-08-24", "\tRemember to check the database first.", "- [ ] Other"].join("\n");
	const list = parseFile(md, "x.md");
	assert.equal(list.tasks[0].note, "Remember to check the database first.");
	assert.equal(list.tasks.length, 2);
});

test("frontmatter config is read", () => {
	const md = ["---", "icon: 💼", "sort: due", "showCompleted: collapsed", "---", "", "- [ ] A"].join("\n");
	const list = parseFile(md, "Work.md");
	assert.equal(list.config.icon, "💼");
	assert.equal(list.config.sort, "due");
	assert.equal(list.config.showCompleted, "collapsed");
	assert.equal(list.name, "Work");
	assert.equal(list.all.length, 1);
});

test("setFields applies several changes at once", () => {
	const t = parseLine("- [ ] Task", 0, "x.md");
	const out = setFields(t, { due: "2026-08-24", priority: "high", myDay: "true" }, "emoji");
	const r = parseLine(out, 0, "x.md");
	assert.equal(r.meta.due, "2026-08-24");
	assert.equal(r.meta.priority, "high");
	assert.equal(r.meta.myDay, true);
	assert.equal(r.title, "Task");
});

test("newTaskLine emits a parseable line", () => {
	const line = newTaskLine("Buy milk", {
		meta: { due: "2026-08-25", priority: "high", myDay: true },
	});
	const t = parseLine(line, 0, "x.md");
	assert.equal(t.title, "Buy milk");
	assert.equal(t.meta.due, "2026-08-25");
	assert.equal(t.meta.priority, "high");
	assert.equal(t.meta.myDay, true);
});

test("windows line endings survive", () => {
	const md = "- [ ] A\r\n- [x] B ✅ 2026-01-01\r\n";
	const list = parseFile(md, "x.md");
	assert.equal(list.all.length, 2);
	const rebuilt = md.split("\n");
	for (const t of list.all) rebuilt[t.line] = setStatusChar(t, t.statusChar);
	assert.equal(rebuilt.join("\n"), md);
});

test("a note at step indentation belongs to the parent, not the last step", () => {
	const md = [
		"- [ ] Write update 📅 2026-08-24",
		"\t- [x] take screenshots",
		"\t- [ ] crop and prep",
		"\tRemember the new pricing table.",
		"- [ ] Other",
	].join("\n");
	const list = parseFile(md, "x.md");
	assert.equal(list.tasks.length, 2, "the note broke the list structure");
	assert.equal(list.tasks[0].note, "Remember the new pricing table.");
	assert.equal(list.tasks[0].children.length, 2);
	assert.equal(list.tasks[0].children[1].note, undefined, "note went to the step");
	assert.deepEqual(list.tasks[0].noteLines, [3]);
});

test("a note indented deeper than a step belongs to that step", () => {
	const md = ["- [ ] Parent", "\t- [ ] Step", "\t\tDetail about the step.", "- [ ] Other"].join("\n");
	const list = parseFile(md, "x.md");
	assert.equal(list.tasks[0].children[0].note, "Detail about the step.");
	assert.equal(list.tasks[0].note, undefined);
	assert.equal(list.tasks.length, 2);
});

test("Work To-Dos: the full metadata surface on real-shaped data", () => {
	const f = files.find((x) => x.name.includes("Work To-Dos"));
	if (!f) return;
	const list = parseFile(f.content, f.name);

	assert.equal(list.config.icon, "💼");
	assert.equal(list.config.showCompleted, "collapsed");

	const write = list.tasks.find((t) => t.title.startsWith("Write update"));
	assert.ok(write, "target task missing");
	assert.equal(write.meta.myDay, true);
	assert.equal(write.meta.reminder, "11:00");
	assert.equal(write.meta.due, "2026-08-24");
	assert.equal(write.meta.created, "2021-01-08");
	assert.equal(write.meta.priority, "high");
	assert.equal(write.children.length, 3, "the 0 of 3 counter would be wrong");
	assert.equal(write.children.filter((c) => c.status === "done").length, 1);
	assert.equal(write.note, "Remember the product entry needs the new pricing table.");

	// Custom statuses stay distinct rather than collapsing to "done".
	assert.ok(list.tasks.some((t) => t.status === "inProgress"), "[/] lost");
	assert.ok(list.tasks.some((t) => t.status === "cancelled"), "[-] lost");
});

test("an emoji filename prefix becomes the icon and leaves the name", () => {
	const list = parseFile("- [ ] a", "lists/📺Shows.md");
	assert.equal(list.config.icon, "📺");
	assert.equal(list.name, "Shows");

	const spaced = parseFile("- [ ] a", "lists/🎓 Certifications.md");
	assert.equal(spaced.config.icon, "🎓");
	assert.equal(spaced.name, "Certifications");

	// A flag is a regional-indicator pair, not one code point.
	const flag = parseFile("- [ ] a", "lists/🇦🇹AT Living.md");
	assert.equal(flag.config.icon, "🇦🇹");
	assert.equal(flag.name, "AT Living");

	// Frontmatter wins over the filename.
	const explicit = parseFile("---\nicon: 💼\n---\n- [ ] a", "lists/📺Shows.md");
	assert.equal(explicit.config.icon, "💼");
	assert.equal(explicit.name, "📺Shows", "name should stay intact when the icon is explicit");

	// A name that is only an emoji keeps it.
	const bare = parseFile("- [ ] a", "lists/🎮.md");
	assert.equal(bare.name, "🎮");
});

test("blockRange covers a task, its note and its descendants", async () => {
	const { blockRange } = await import("./model.mjs");
	const md = [
		"- [ ] Parent",
		"\t- [ ] Step one",
		"\t- [ ] Step two",
		"\tA note line.",
		"- [ ] Next",
	].join("\n");
	const list = parseFile(md, "x.md");
	assert.deepEqual(blockRange(list.tasks[0]), { start: 0, end: 4 });
	assert.deepEqual(blockRange(list.tasks[1]), { start: 4, end: 5 });
});

/**
 * A stamp that carries a time, through the parser and back out.
 *
 * The risk this guards is not the parse but the round trip: the emoji dialect
 * is split on whitespace, so anything the serialiser writes with a space in it
 * comes back as a date followed by a word, and the word lands in the title
 * where the user can see it.
 */
describe("datetime stamps", () => {
	// The real write path: rewriting a field is what the app does when a box is
	// ticked, so a round trip through it is the thing worth asserting.
	const rewrite = (line) => {
		const t = parseFile(line + "\n", "lists/a.md").tasks[0];
		const field = t.meta.done !== undefined ? "done" : "created";
		return { task: t, out: setField(t, field, t.meta[field], "emoji") };
	};

	test("a stamp with a time survives a round trip unchanged", () => {
		const line = "- [x] Cake ✅ 2026-08-26T14:32";
		const { task, out } = rewrite(line);
		assert.equal(task.meta.done, "2026-08-26T14:32");
		assert.equal(task.title, "Cake");
		assert.equal(out, line);
	});

	test("as does a bare date, which is what a vault is full of", () => {
		const line = "- [x] Cake ✅ 2026-08-26";
		const { task, out } = rewrite(line);
		assert.equal(task.meta.done, "2026-08-26");
		assert.equal(out, line);
	});

	test("a hand-typed space is normalised on the way in", () => {
		// Accepted, because somebody editing markdown will type it — but it is
		// not what gets written back, or the next parse would read the time as
		// a word and put it in the title.
		const { task, out } = rewrite("- [x] Cake ✅ 2026-08-26 14:32");
		assert.equal(task.meta.done, "2026-08-26T14:32");
		assert.equal(out, "- [x] Cake ✅ 2026-08-26T14:32");
	});

	test("and the title never picks up the time", () => {
		const t = parseFile("- [x] Cake ✅ 2026-08-26T14:32\n", "lists/a.md").tasks[0];
		assert.equal(t.title, "Cake");
	});

	test("and a created stamp works the same way", () => {
		const t = parseFile("- [ ] Cake ➕ 2026-08-26T09:05\n", "lists/a.md").tasks[0];
		assert.equal(t.meta.created, "2026-08-26T09:05");
		assert.equal(t.title, "Cake");
	});
});
