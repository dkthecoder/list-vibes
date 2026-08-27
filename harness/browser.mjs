/**
 * Launching Chromium, wherever it happens to live.
 *
 * Every suite here used to hardcode `/opt/pw-browsers/chromium`, which is where
 * the development container keeps it. That is fine until the suites run
 * somewhere else — a GitHub runner, or anybody's laptop — where the path does
 * not exist and every suite fails at `launch()` before asserting anything.
 *
 * So: use `PLAYWRIGHT_BROWSERS_PATH` or an explicit `CHROMIUM_PATH` when one is
 * set and real, and otherwise let Playwright find the browser it installed.
 * Both are one line, and the difference is whether the tests are portable.
 */
import { chromium } from "playwright";
import { existsSync } from "fs";

/** An explicit binary, if this machine has one worth pointing at. */
function executablePath() {
	const explicit = process.env.CHROMIUM_PATH;
	if (explicit && existsSync(explicit)) return explicit;

	// The container's layout: PLAYWRIGHT_BROWSERS_PATH holding a plain
	// `chromium` binary rather than Playwright's own versioned tree.
	const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
	if (root) {
		const candidate = `${root.replace(/\/$/, "")}/chromium`;
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

/** Launch, with whatever this machine has. */
export function launch(options = {}) {
	const exe = executablePath();
	return chromium.launch(exe ? { executablePath: exe, ...options } : options);
}
