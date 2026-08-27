/**
 * Per-platform renders of the plugin, for the README and the store listing.
 *
 * These are the plugin's real code and real stylesheet — `renderListsPane`,
 * `renderTasksPane`, `renderDetailPane`, `styles.css` — rendered headless
 * against the fixture vault. What they are *not* is a photograph of Obsidian:
 * there is no title bar, no ribbon, no tab strip, and the tasks are fixtures
 * rather than anybody's real list.
 *
 * That distinction matters for a store listing, where a screenshot is a claim
 * about what someone will see. So these are a starting point and a fallback,
 * and the filenames are chosen so a real capture from a real vault can be
 * dropped straight over the top with no README edit:
 *
 *   screenshots/desktop.png
 *   screenshots/tablet.png
 *   screenshots/mobile.png
 *
 * Run with: npm run screenshots
 */
import { launch } from "../harness/browser.mjs";
import { mkdirSync } from "fs";

const url = "file://" + process.cwd() + "/harness/index.html";
mkdirSync("screenshots", { recursive: true });

/**
 * One shot each, at the size the platform actually is.
 *
 * `frame` names which of the harness's rendered panes to capture: the desktop
 * one shows the picker and the list side by side, the tablet one the same at a
 * narrower width, and the phone one the single-pane layout it collapses to.
 */
const SHOTS = [
	{ name: "desktop", frame: "#drag", width: 1280, height: 800, body: "" },
	{ name: "tablet", frame: "#drag", width: 900, height: 1000, body: "is-mobile is-tablet" },
	{ name: "mobile", frame: "#m-tasks", width: 412, height: 800, body: "is-mobile is-phone" },
];

const browser = await launch();

for (const shot of SHOTS) {
	const page = await browser.newPage({
		viewport: { width: shot.width + 80, height: shot.height + 80 },
		// Retina, because a store listing is viewed on one.
		deviceScaleFactor: 2,
	});
	const errors = [];
	page.on("pageerror", (e) => errors.push(String(e)));
	await page.goto(url);
	await page.waitForTimeout(250);

	await page.evaluate(
		({ frame, width, height, body }) => {
			if (body) document.body.className = body;
			// Everything except the one frame, out of the way — the harness page
			// is a contact sheet and this wants one picture.
			for (const el of document.querySelectorAll("body > *")) {
				el.style.display = "none";
			}
			const target = document.querySelector(frame);
			const holder = target.closest("body > *") ?? target;
			holder.style.display = "";
			target.style.width = `${width}px`;
			target.style.height = `${height}px`;
			target.style.margin = "0";
			document.body.style.margin = "0";
			document.body.style.padding = "0";
			if (window.paint) window.paint();
		},
		shot
	);
	await page.waitForTimeout(250);

	const el = await page.$(shot.frame);
	await el.screenshot({ path: `screenshots/${shot.name}.png` });
	if (errors.length) console.log(`${shot.name}: ${errors.slice(0, 2).join(" | ")}`);
	console.log(`  screenshots/${shot.name}.png  ${shot.width}x${shot.height} @2x`);
	await page.close();
}

await browser.close();
