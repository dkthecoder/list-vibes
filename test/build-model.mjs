// Bundles the pure model layer and the write layer to ESM so both can be
// unit-tested in plain node. `obsidian` is aliased to an in-memory stub.
import esbuild from "esbuild";

const aliasObsidian = {
	name: "alias-obsidian",
	setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({
			path: "../obsidian-stub.mjs",
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
	entryPoints: ["src/model/mutate.ts", "src/model/store.ts"],
	bundle: true,
	format: "esm",
	target: "es2022",
	platform: "node",
	outdir: "test/build",
	plugins: [aliasObsidian],
	logLevel: "warning",
});
