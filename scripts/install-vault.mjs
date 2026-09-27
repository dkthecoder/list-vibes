/**
 * Build once and install into one or more Obsidian vaults.
 *
 *   node scripts/install-vault.mjs "/path/to/vault" ["/another/vault" ...]
 *   npm run install:vault -- "/path/to/vault"
 *
 * or set OBSIDIAN_VAULT (or OBSIDIAN_VAULTS, comma-separated) and pass nothing.
 *
 * The one-shot counterpart to `dev:vault`, which watches and stays running. Use
 * this to put the current working tree into a vault and go and use it — testing
 * a change by hand needs the build in the vault, not a watcher in a terminal.
 *
 * Writes only main.js, manifest.json and styles.css into
 * <vault>/.obsidian/plugins/list-vibes/. Nothing else, and nothing in the notes.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import process from "process";

const FILES = ["main.js", "manifest.json", "styles.css"];
const PLUGIN_DIR = path.join(".obsidian", "plugins", "list-vibes");

const targets = process.argv.slice(2).length
	? process.argv.slice(2)
	: (process.env.OBSIDIAN_VAULTS ?? process.env.OBSIDIAN_VAULT ?? "")
			.split(",")
			.map((v) => v.trim())
			.filter(Boolean);

if (!targets.length) {
	console.error(
		'Usage: node scripts/install-vault.mjs "/path/to/vault" ["/another/vault" ...]\n' +
			'   or: export OBSIDIAN_VAULTS="/path/one,/path/two"'
	);
	process.exit(1);
}

/*
 * Every target is checked before anything is built or copied. A typo in the
 * second path should not leave the first vault holding a build the others do not.
 */
const bad = targets.filter((v) => !fs.existsSync(path.join(v, ".obsidian")));
if (bad.length) {
	for (const v of bad) console.error(`not an Obsidian vault (no .obsidian): ${v}`);
	process.exit(1);
}

console.log("building…");
execFileSync("npm", ["run", "build"], { stdio: "inherit" });

const missing = FILES.filter((f) => !fs.existsSync(f));
if (missing.length) {
	console.error(`build produced no ${missing.join(", ")}`);
	process.exit(1);
}

const version = JSON.parse(fs.readFileSync("manifest.json", "utf8")).version;

for (const vault of targets) {
	const dest = path.join(vault, PLUGIN_DIR);
	fs.mkdirSync(dest, { recursive: true });
	for (const f of FILES) fs.copyFileSync(f, path.join(dest, f));
	console.log(`installed ${version} → ${dest}`);
}

console.log(
	"\nReload the plugin in each vault to pick it up:\n" +
		"  with Hot Reload installed (a .hotreload file in the vault), it is already live\n" +
		"  otherwise: Settings → Community plugins → toggle List Vibes off and on"
);
