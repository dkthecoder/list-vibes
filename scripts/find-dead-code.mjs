/**
 * Report code nothing uses.
 *
 *   node scripts/find-dead-code.mjs           # the two categories worth acting on
 *   node scripts/find-dead-code.mjs --exports # also list exports only their own file uses
 *
 * eslint catches an unused local. What it cannot see is a function every caller
 * has stopped calling — which still compiles, still passes its tests, and is
 * reachable from nothing.
 *
 * Two findings are worth acting on:
 *
 * - **dead** — no reference in src, test or harness. Delete it.
 * - **tested but unwired** — only tests or the harness reference it. The test
 *   proves it works, not that anything wants it; this is where a half-finished
 *   idea hides, looking healthy because it is green.
 *
 * A third category is mostly noise and is off by default: a symbol exported but
 * used only inside its own file. For a type that is often deliberate — the
 * options object of an exported function belongs in the API whether or not
 * anything imports its name — and for the pure helpers this codebase extracts so
 * that node can test them, the export *is* the point. Judgement, not a rule.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import process from "process";

const showExports = process.argv.includes("--exports");

function walk(dir) {
	const out = [];
	for (const name of readdirSync(dir)) {
		const full = path.join(dir, name);
		if (statSync(full).isDirectory()) out.push(...walk(full));
		else if (/\.(ts|mjs)$/.test(name)) out.push(full);
	}
	return out;
}

const src = walk("src");
const proving = [...walk("test"), ...walk("harness")];
const text = new Map();
for (const f of [...src, ...proving]) text.set(f, readFileSync(f, "utf8"));

/*
 * A regex over the declaration forms this codebase uses, rather than a
 * TypeScript program: every export here is a plain `export <kind> <name>`, and a
 * false positive costs one glance where a new dependency costs forever.
 */
const DECL =
	/^export\s+(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;

const dead = [];
const unwired = [];
const localOnly = [];

for (const file of src) {
	const body = text.get(file);
	for (const m of body.matchAll(DECL)) {
		const name = m[1];
		const word = new RegExp(`\\b${name}\\b`);
		const inSrc = src.filter((o) => o !== file && word.test(text.get(o))).length;
		const inProving = proving.filter((o) => word.test(text.get(o))).length;
		/*
		 * Its own file, counting occurrences and discounting the declaration.
		 * Skipping whole `export` lines instead hid every use inside an exported
		 * signature — a type named in `export function f(o: Options)` read as
		 * unused, which is where a checker like this earns its reputation for
		 * crying wolf.
		 */
		const inOwn =
			(body.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length - 1;

		if (inSrc === 0 && inProving === 0 && inOwn === 0) dead.push({ file, name });
		else if (inSrc === 0 && inOwn === 0) unwired.push({ file, name, by: inProving });
		else if (inSrc === 0 && inProving === 0) localOnly.push({ file, name });
	}
}

const line = (d) => `  ${d.file}  ${d.name}`;

if (dead.length) {
	console.log(`DEAD — nothing in src, test or harness references these (${dead.length}):\n`);
	dead.forEach((d) => console.log(line(d)));
	console.log();
}

if (unwired.length) {
	console.log(`TESTED BUT UNWIRED — only tests or the harness use these (${unwired.length}):\n`);
	unwired.forEach((d) => console.log(`${line(d)}  — ${d.by} test/harness file(s), no caller in src`));
	console.log();
}

if (showExports && localOnly.length) {
	console.log(`EXPORTED BUT LOCAL — judgement call, often deliberate (${localOnly.length}):\n`);
	localOnly.forEach((d) => console.log(line(d)));
	console.log();
}

if (!dead.length && !unwired.length) {
	console.log("Nothing dead and nothing tested-but-unwired.");
	if (!showExports) console.log("Run with --exports to review exports only their own file uses.");
	process.exit(0);
}
process.exit(1);
