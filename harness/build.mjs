import esbuild from "esbuild";

// Alias the `obsidian` import to the local mock so the real pane code runs
// unmodified in a plain browser.
const aliasObsidian = {
	name: "alias-obsidian",
	setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({
			path: new URL("./obsidian-mock.ts", import.meta.url).pathname,
		}));
	},
};

await esbuild.build({
	entryPoints: ["harness/main.ts"],
	bundle: true,
	format: "iife",
	target: "es2022",
	outfile: "harness/bundle.js",
	plugins: [aliasObsidian],
	logLevel: "warning",
});
