// Bundles the pure model layer and the write layer to ESM so both can be
// unit-tested in plain node. `obsidian` is aliased to an in-memory stub.
import esbuild from "esbuild";

const aliasObsidian = {
	name: "alias-obsidian",
	setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({
			// Relative to the bundle's own location, which is test/build/<dir>/.
			path: "../../obsidian-stub.mjs",
			external: true,
		}));
	},
};

await esbuild.build({
	entryPoints: ["src/model/index.ts"],
	bundle: true,
	format: "esm",
	target: "es2022",
	platform: "node",
	outfile: "test/model.mjs",
	logLevel: "warning",
});

await esbuild.build({
	entryPoints: [
		"src/model/mutate.ts",
		"src/model/store.ts",
		"src/views/viewState.ts",
		"src/ui/dragSort.ts",
		"src/ui/notePreview.ts",
		"src/ui/prettify.ts",
		"src/ui/swipeDismiss.ts",
		"src/views/keyboard.ts",
		"src/views/doubleKeyboard.ts",
		"src/views/context.ts",
		"src/ui/IconModal.ts",
	],
	bundle: true,
	format: "esm",
	target: "es2022",
	platform: "node",
	// Pin the base so output paths stay flat and predictable as entries are added.
	outbase: "src",
	outdir: "test/build",
	plugins: [aliasObsidian],
	logLevel: "warning",
});
