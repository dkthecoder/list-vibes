/**
 * Is every colour in this plugin the user's, or are some of them ours?
 *
 * `theme.mjs` spot-checks a dozen named properties, which proves the linkage
 * exists but not that it is everywhere. This is the exhaustive version, and it
 * works by contradiction rather than by inspection: repaint every Obsidian
 * colour token the stylesheet references, then walk **every element in the
 * view** and read **every colour-bearing property**. Anything still the colour
 * it was before is a colour this plugin decided on its own.
 *
 * That is a claim that can actually fail, which "we use CSS variables" is not.
 * A single hardcoded hex, a forgotten `#fff` on an icon, a shadow with a literal
 * rgba in it — each shows up here as a named element and a named property.
 *
 * The tokens are listed rather than discovered because the list is the
 * assertion: these are the colours Obsidian offers, and the plugin is claiming
 * to want no others.
 */
import { chromium } from "playwright";
import { readFileSync } from "fs";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const results = [];
const check = (name, pass, detail = "") => {
	results.push({ name, pass, detail });
	console.log(`${pass ? "  ok  " : "  FAIL"} ${name}${detail ? "  — " + detail : ""}`);
};

/**
 * Every colour token the stylesheet mentions.
 *
 * Kept in step with the stylesheet by a check below rather than by discipline:
 * add a `var(--some-new-colour)` and forget to list it here, and the suite says
 * so instead of quietly testing less than it did yesterday.
 */
const COLOUR_TOKENS = [
	"--background-primary",
	"--background-secondary",
	"--background-modifier-hover",
	"--background-modifier-active-hover",
	"--background-modifier-border",
	"--background-modifier-form-field",
	"--divider-color",
	"--text-normal",
	"--text-muted",
	"--text-faint",
	"--text-accent",
	"--text-error",
	"--text-on-accent",
	"--interactive-accent",
	"--nav-item-color",
	"--nav-item-color-hover",
	"--nav-item-color-active",
	"--nav-item-background-hover",
	"--nav-item-background-active",
	"--color-red",
	"--color-orange",
	"--color-yellow",
	"--color-green",
	"--color-cyan",
	"--color-blue",
	"--color-purple",
	"--color-pink",
	"--shadow-l",
];

/* ---- 0. The list is still the whole list ---- */

const css = readFileSync("styles.css", "utf8");
const referenced = [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]))]
	.filter((t) => !t.startsWith("--lv-"))
	// Colour-ish by name. A token this matches but the list omits is a colour
	// nothing below would ever look at.
	.filter((t) => /color|background|text-|accent|divider|shadow|fill/.test(t))
	.filter((t) => t !== "--divider-width");
const missing = referenced.filter((t) => !COLOUR_TOKENS.includes(t));
check(
	"every colour token the stylesheet uses is one this suite repaints",
	missing.length === 0,
	missing.length ? `not repainted: ${missing.join(", ")}` : `${referenced.length} tokens`
);

const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("file://" + process.cwd() + "/harness/index.html");
await page.waitForTimeout(250);

/* ---- 1. Every painted colour, before and after ---- */

const PROPS = [
	"color",
	"backgroundColor",
	"borderTopColor",
	"borderRightColor",
	"borderBottomColor",
	"borderLeftColor",
	"outlineColor",
	"textDecorationColor",
	"caretColor",
	"fill",
	"stroke",
	"boxShadow",
];

const snapshot = (panes) =>
	page.evaluate(
		({ panes, PROPS }) => {
			const out = {};
			for (const pane of panes) {
				const root = document.querySelector(`${pane} .lv-root`);
				if (!root) continue;
				const all = [root, ...root.querySelectorAll("*")];
				all.forEach((el, i) => {
					const cs = getComputedStyle(el);
					// A name a human can act on. The index disambiguates the
					// twentieth `.lv-task` from the first.
					const name = `${pane}${el.tagName.toLowerCase()}.${String(
						el.getAttribute("class") ?? ""
					)
						.split(" ")[0]
						.slice(0, 22)}#${i}`;
					for (const prop of PROPS) {
						// `fill` and `stroke` are inherited SVG properties and
						// compute to black on every div in the document. Reading
						// them off non-SVG elements finds 900 "hardcoded" colours
						// that are not painted and are not ours.
						if ((prop === "fill" || prop === "stroke") && !(el instanceof SVGElement)) {
							continue;
						}
						const v = cs[prop];
						if (!v || v === "none" || v === "auto") continue;
						// Not painted, so it has no colour to get wrong.
						if (v === "rgba(0, 0, 0, 0)" || v === "transparent") continue;
						out[`${name}|${prop}`] = v;
					}
				});
			}
			return out;
		},
		{ panes, PROPS }
	);

/**
 * Which colours are *ours* to answer for.
 *
 * The view is full of colour this plugin did not choose: core classes it
 * borrows on purpose — `clickable-icon`, `task-list-item-checkbox` — plus the
 * harness's own stand-in for `app.css`. Auditing those finds hundreds of
 * "hardcoded" colours that belong to Obsidian and would follow a real theme
 * perfectly well.
 *
 * So the stylesheet is switched off, the view measured, switched on, and
 * measured again. What changed between the two is exactly what `styles.css` is
 * responsible for, and that is the set with something to prove.
 */
const setOurCss = (on) =>
	page.evaluate((on) => {
		const link = document.querySelector('link[href$="styles.css"]');
		link.disabled = !on;
	}, on);

const PANES = ["#drag", "#picker", "#m-tasks"];

await setOurCss(false);
await page.waitForTimeout(150);
const bare = await snapshot(PANES);

await setOurCss(true);
await page.waitForTimeout(150);
const before = await snapshot(PANES);

const ours = Object.keys(before).filter((k) => before[k] !== bare[k]);
check(
	"there is a view to inspect, and colour in it that is ours",
	ours.length > 30,
	`${ours.length} of ${Object.keys(before).length} painted colours come from styles.css`
);

/* ---- 2. Repaint the palette ---- */

await page.evaluate(
	({ COLOUR_TOKENS }) => {
		// On `body`, where Obsidian declares them, so they reach the plugin the
		// same way a real theme's would — through inheritance, not by being
		// pushed onto its root.
		COLOUR_TOKENS.forEach((token, i) => {
			// Distinct per token, so nothing can accidentally match its old value.
			const hue = (i * 37) % 360;
			const value =
				token === "--shadow-l"
					? `0 1px 2px hsl(${hue} 90% 40%)`
					: `hsl(${hue} 90% 40%)`;
			document.body.style.setProperty(token, value);
		});
	},
	{ COLOUR_TOKENS }
);
await page.waitForTimeout(150);

const after = await snapshot(PANES);

/* ---- 3. Anything unchanged is ours, not theirs ---- */

const stuck = ours.filter((k) => after[k] === before[k]);
check(
	"no colour in the view survives a change of palette",
	stuck.length === 0,
	stuck.length
		? `${stuck.length} hardcoded: ${stuck.slice(0, 4).map((k) => `${k}=${before[k]}`).join("  ")}`
		: `${Object.keys(before).length} colours, all of them the theme's`
);

/* ---- 4. And light/dark is Obsidian's to decide ---- */

const ownScheme = /prefers-color-scheme/.test(css);
check(
	"the stylesheet has no colour scheme opinion of its own",
	!ownScheme,
	// Obsidian already flips `theme-light` / `theme-dark` on the body and
	// repoints every token. A `prefers-color-scheme` block here would fight it
	// for any user whose Obsidian theme disagrees with their OS.
	ownScheme ? "found a prefers-color-scheme block" : "none"
);

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
