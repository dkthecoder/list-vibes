/**
 * The view under core's own `.view-content` padding, which is the fault.
 *
 * Every other suite here builds `.lv-root` as a child of a `.view-content`.
 * Obsidian does not: a plugin is handed the view's content element and adds its
 * class to *that*, so the two are one element and every rule core writes for
 * `.view-content` lands on our root. The harness modelling them as two is why
 * this was invisible here for eight rounds while it was breaking a tablet.
 *
 * The rule that matters, read off the device rather than remembered:
 *
 *     .view-content { padding-bottom: max(var(--keyboard-height), 32px); }
 *
 * For a note that is harmless — the editor is a tall scroller and bottom
 * padding just adds room past the last line. For a fixed `height: 100%` layout
 * inside a leaf core has already shortened to `100vh - keyboard`, it eats the
 * content box and every pane inside collapses to nothing.
 */
import { launch } from "./browser.mjs";

const browser = await launch();
const results = [];
const check = (name, pass, detail = "") => {
	results.push({ name, pass, detail });
	console.log(`${pass ? "  ok  " : "  FAIL"} ${name}${detail ? "  — " + detail : ""}`);
};

// The phone the dump came from: 412x892 CSS px, keyboard 463 — a hair over
// half the viewport, which is the proportion the checks below reproduce.
const page = await browser.newPage({
	viewport: { width: 412, height: 891 },
	isMobile: true,
	hasTouch: true,
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("file://" + process.cwd() + "/harness/index.html");
await page.waitForTimeout(200);

const measure = await page.evaluate(() => {
		document.body.className = "is-mobile is-android is-phone is-floating-nav";
		// The app shell is `height: 100%`, which needs a chain to resolve against.
		// Without this every box measures 0 and the suite passes for the wrong
		// reason — which is how a check ends up guarding nothing.
		// `100vh` measured rather than assumed: under device emulation it is not
		// window.innerHeight, and the whole suite is arithmetic against it.
		const probe = document.createElement("div");
		probe.style.cssText = "position:fixed;top:0;left:0;width:1px;height:100vh;visibility:hidden";
		document.body.appendChild(probe);
		const vh = Math.round(probe.getBoundingClientRect().height);
		probe.remove();
		// The keyboard in the same proportion the device reported: 463 of 891.
		const keyboard = Math.round(vh * (463 / 891));

		// Core's rules, verbatim from what the plugin read on the device.
		const core = document.createElement("style");
		core.textContent = `
			:root { --keyboard-height: 0px; }
			body.is-mobile .app-container { max-height: calc(100vh - var(--keyboard-height)); }
			/*
			 * Deliberately far more specific than anything the plugin would
			 * write. Core's real selector has not been read; all that is known
			 * is that it beats a plain \`.lv-root\`. Pitching the stand-in this
			 * high means the fix is only passing if it does not depend on
			 * winning a specificity contest at all.
			 */
			.is-phone.is-floating-nav .workspace-leaf-content .view-content {
				padding-bottom: max(var(--keyboard-height), 32px);
			}
		`;
		document.head.insertBefore(core, document.head.firstChild);

		// The shell, as the dump reports it: every box between the app container
		// and the view is a full-height flex column that hands its height down.
		const app = document.createElement("div");
		app.className = "app-container";
		// Anchored to the viewport, because this page is a gallery rather than an
		// app and `height: 100%` would resolve against the whole scrolling document.
		app.style.cssText = "display:flex;flex-direction:column;height:100vh;width:412px;";
		const leaf = document.createElement("div");
		leaf.className = "workspace-leaf";
		leaf.style.cssText = "display:flex;flex:1 0 0;overflow:hidden;contain:strict;position:relative;";
		const content = document.createElement("div");
		content.className = "workspace-leaf-content";
		content.style.cssText = "display:flex;height:100%;width:100%;overflow:hidden;position:relative;";

		// The single element that is both. This is the fidelity that was missing.
		const src = document.querySelector("#m-tasks .lv-root");
		const root = src.cloneNode(true);
		root.id = "collapse";
		root.className = "view-content " + root.className;
		root.removeAttribute("style");

		content.appendChild(root);
		leaf.appendChild(content);
		app.appendChild(leaf);
		document.body.appendChild(app);
		if (window.paint) window.paint();

		const h = (sel) => {
			const el = root.matches(sel) ? root : root.querySelector(sel);
			return el ? Math.round(el.getBoundingClientRect().height) : -1;
		};
		const pad = () => Math.round(parseFloat(getComputedStyle(root).paddingBottom));

		const rest = { root: h(".lv-root"), pane: h(".lv-pane"), pad: pad() };

		document.documentElement.style.setProperty("--keyboard-height", `${keyboard}px`);
		root.classList.add("is-keyboard-open");
		const typing = {
			app: Math.round(app.getBoundingClientRect().height),
			root: h(".lv-root"),
			pane: h(".lv-pane"),
			pad: pad(),
		};

		return { rest, typing, vh, keyboard };
});

const { rest, typing, vh, keyboard } = measure;

check(
	"core still shortens the app by one keyboard, as it should",
	Math.abs(typing.app - (vh - keyboard)) <= 2,
	`app ${typing.app} against ${vh} - ${keyboard}`
);
check(
	"our root takes no keyboard-sized padding, whatever selector core used",
	typing.pad <= 32,
	`padding-bottom=${typing.pad}px with a ${keyboard}px keyboard`
);
check(
	"and at rest it is core's floor, not a keyboard",
	rest.pad <= 32,
	`padding-bottom=${rest.pad}px`
);
check(
	"so the pane still has height with the keyboard up",
	typing.pane > 100,
	`pane=${typing.pane}px inside a ${typing.app}px app`
);
check(
	"and it fills the shortened leaf rather than overflowing it",
	typing.root > 0 && typing.root <= typing.app + 2,
	`root=${typing.root}px in ${typing.app}px`
);

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
