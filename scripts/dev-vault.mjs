/**
 * Watch build straight into an Obsidian vault.
 *
 *   npm run dev:vault -- "/path/to/your/vault"
 *
 * or set OBSIDIAN_VAULT once and just run `npm run dev:vault`.
 *
 * Writes main.js, manifest.json and styles.css into
 * <vault>/.obsidian/plugins/list-vibes/ on every save. Only those three files
 * go into the vault — the repo stays outside it, so node_modules never ends up
 * somewhere Obsidian would try to index.
 */
import esbuild from "esbuild";
import fs from "fs";
import path from "path";
import process from "process";
import builtins from "builtin-modules";

const vault = process.argv[2] || process.env.OBSIDIAN_VAULT;

if (!vault) {
	console.error(
		'Usage: npm run dev:vault -- "/path/to/your/vault"\n' +
			'   or: export OBSIDIAN_VAULT="/path/to/your/vault"'
	);
	process.exit(1);
}

if (!fs.existsSync(path.join(vault, ".obsidian"))) {
	console.error(
		`Not an Obsidian vault: ${vault}\n` +
			"(no .obsidian folder inside it — open the vault in Obsidian once first)"
	);
	process.exit(1);
}

const dest = path.join(vault, ".obsidian", "plugins", "list-vibes");
fs.mkdirSync(dest, { recursive: true });

/** Copy the static files, and opt this plugin in to Hot-Reload. */
function copyStatic() {
	for (const f of ["manifest.json", "styles.css"]) {
		fs.copyFileSync(f, path.join(dest, f));
	}
	// An empty .hotreload file is how pjeby/hot-reload opts a plugin in.
	fs.writeFileSync(path.join(dest, ".hotreload"), "");
}
copyStatic();

const banner = "/* Built by list-vibes dev:vault — edit the repo, not this file. */\n";

const ctx = await esbuild.context({
	banner: { js: banner },
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtins,
	],
	format: "cjs",
	target: "es2022",
	logLevel: "info",
	sourcemap: "inline",
	treeShaking: true,
	outfile: path.join(dest, "main.js"),
	plugins: [
		{
			name: "copy-static-on-rebuild",
			setup(build) {
				build.onEnd((result) => {
					if (result.errors.length) return;
					copyStatic();
					console.log(`  → ${dest}`);
				});
			},
		},
	],
});

console.log(`Watching src/ → ${dest}`);
console.log("Save a file to rebuild. Ctrl+C to stop.\n");
await ctx.watch();
