/**
 * Keeps manifest.json and versions.json in step with package.json.
 *
 * Run automatically by `npm version` via the "version" script, so a release is
 * one command:
 *
 *   npm version patch    # or minor / major
 *   git push && git push --tags
 *
 * versions.json maps each plugin version to the minimum Obsidian version it
 * needs. Obsidian reads it to decide which release to offer someone on an older
 * app version, so an entry missing here means those users silently get nothing.
 */
import { readFileSync, writeFileSync } from "fs";

const target = process.env.npm_package_version;
if (!target) {
	console.error("No npm_package_version — run this through `npm version`, not directly.");
	process.exit(1);
}

if (!/^\d+\.\d+\.\d+/.test(target)) {
	console.error(`Refusing to write a non-semver version: ${target}`);
	process.exit(1);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const previous = manifest.version;
manifest.version = target;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t") + "\n");

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[target] = manifest.minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t") + "\n");

console.log(
	`${previous} -> ${target}  (requires Obsidian ${manifest.minAppVersion})\n` +
		"manifest.json and versions.json updated and staged."
);
