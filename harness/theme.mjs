/**
 * Does the plugin actually follow the user's Obsidian settings?
 *
 * The claim "we use Obsidian's variables" is easy to make and easy to quietly
 * break — one hardcoded colour, one raw pixel value, and a corner of the plugin
 * stops moving with the theme. This changes the tokens the way a theme or a
 * settings change would, and checks the plugin moved.
 *
 * What is being tested is the *linkage*, not the values. Any specific number
 * here would just be restating the stylesheet back to itself.
 */
import { launch } from "./browser.mjs";

const url = "file://" + process.cwd() + "/harness/index.html";
const browser = await launch();

const results = [];
const check = (name, pass, detail = "") => {
	results.push({ name, pass, detail });
	console.log(`${pass ? "  ok  " : "  FAIL"} ${name}${detail ? "  — " + detail : ""}`);
};

const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForTimeout(200);

const PANE = "#drag";

/** Computed values for the things a user's settings should reach. */
const sample = () =>
	page.evaluate((pane) => {
		// The frame is the leaf; the view is inside it. An empty selector means
		// the view's own root, which is where its tokens are declared — reading
		// them off the leaf would find whatever the page happens to inherit.
		const at = (sel) => document.querySelector(`${pane} .lv-root ${sel}`.trim());
		const g = (sel, prop) => {
			const el = at(sel);
			return el ? getComputedStyle(el)[prop] : null;
		};
		const v = (sel, name) => {
			const el = at(sel);
			return el ? getComputedStyle(el).getPropertyValue(name).trim() : null;
		};
		return {
			rootFont: g("", "fontFamily"),
			titleSize: g(".lv-header-title", "fontSize"),
			taskTitleSize: g(".lv-task-title", "fontSize"),
			navLabelSize: g(".lv-nav-label", "fontSize"),
			taskPadding: g(".lv-task", "padding"),
			taskRadius: g(".lv-task", "borderRadius"),
			navWidth: g(".lv-nav", "width"),
			accent: v("", "--lv-accent"),
			textColour: g(".lv-task-title", "color"),
			paneBackground: g(".lv-pane", "backgroundColor"),
			addBackground: g(".lv-add", "backgroundColor"),
			rowHover: v("", "--nav-item-background-hover"),
			checkboxSize: v("", "--checkbox-size"),
		};
	}, PANE);

/** Apply settings the way Obsidian applies them: variables on :root and body. */
const apply = (vars, bodyClasses = "") =>
	page.evaluate(
		({ vars, bodyClasses }) => {
			for (const [k, val] of Object.entries(vars)) {
				document.documentElement.style.setProperty(k, val);
			}
			if (bodyClasses) document.body.className = bodyClasses;
		},
		{ vars, bodyClasses }
	);

const before = await sample();
check("the plugin renders", !!before.taskTitleSize, JSON.stringify(before.taskTitleSize));

/* ---- 1. A theme changing the interface font ---- */
await apply({ "--font-interface": "Georgia, serif" });
let after = await sample();
check(
	"the interface font follows the theme",
	after.rootFont !== before.rootFont && /Georgia/.test(after.rootFont),
	after.rootFont
);

/* ---- 2. A theme changing the UI type scale ----
   On a phone Obsidian derives --font-ui-* from the reading font size; on
   desktop they are fixed. Either way a theme may set them directly, and the
   plugin has to follow rather than carry its own numbers. */
await apply({
	"--font-ui-smaller": "20px",
	"--font-ui-small": "22px",
	"--font-ui-medium": "26px",
	"--font-ui-large": "34px",
});
after = await sample();
check("the title follows the type scale", after.titleSize !== before.titleSize,
	`${before.titleSize} -> ${after.titleSize}`);
check("task text follows the type scale", after.taskTitleSize !== before.taskTitleSize,
	`${before.taskTitleSize} -> ${after.taskTitleSize}`);
check("picker rows follow the type scale", after.navLabelSize !== before.navLabelSize,
	`${before.navLabelSize} -> ${after.navLabelSize}`);
check(
	"checkboxes follow it too, rather than staying a fixed size",
	after.checkboxSize !== before.checkboxSize,
	`${before.checkboxSize} -> ${after.checkboxSize}`
);
check(
	"the list column widens with the type, so text is not squeezed",
	parseFloat(after.navWidth) > parseFloat(before.navWidth),
	`${before.navWidth} -> ${after.navWidth}`
);

/* ---- 3. A theme changing spacing and radii ---- */
await apply({
	"--size-4-1": "9px",
	"--size-4-2": "18px",
	"--radius-s": "9px",
});
after = await sample();
check("padding follows the spacing scale", after.taskPadding !== before.taskPadding,
	`${before.taskPadding} -> ${after.taskPadding}`);
/*
 * Radius follows the theme, but only up to a point — `--lv-radius-s` is a
 * `min()`, so a theme drawing pills gets rounded corners here instead. 9px is
 * under the cap, so this still asserts the scale is being read at all; the
 * refusal above the cap is checked in `harness/rows.mjs`.
 *
 * `--nav-item-radius` is deliberately not what is set here any more. The rows
 * used to take it, which is how a theme's pill nav items turned a list of tasks
 * into a list of lozenges.
 */
check("corners follow the radius scale, under the cap", after.taskRadius !== before.taskRadius,
	`${before.taskRadius} -> ${after.taskRadius}`);

/* ---- 4. The accent colour from appearance settings ---- */
await apply({ "--interactive-accent": "rgb(255, 0, 128)" });
after = await sample();
check(
	"an uncustomised list takes the user's accent colour",
	after.accent !== before.accent && /255/.test(after.accent),
	`${before.accent} -> ${after.accent}`
);

/* ---- 5. The theme's own colours ---- */
await apply({
	"--text-normal": "rgb(0, 200, 0)",
	"--background-primary": "rgb(20, 0, 40)",
	"--nav-item-background-hover": "rgb(1, 2, 3)",
});
after = await sample();
check("text colour follows the theme", after.textColour !== before.textColour,
	`${before.textColour} -> ${after.textColour}`);
check(
	"opaque surfaces follow the theme",
	after.addBackground !== before.addBackground,
	`${before.addBackground} -> ${after.addBackground}`
);
check("row hover follows the theme", after.rowHover !== before.rowHover,
	`${before.rowHover} -> ${after.rowHover}`);

/* ---- 5b. The view sits on Obsidian's surface rather than painting its own ----
   Obsidian colours a leaf itself, and differently depending on where the leaf
   is: `--background-secondary` in a sidebar, `--background-primary` in the main
   workspace. A pane that paints `--background-primary` regardless is right in a
   tab and a bright rectangle in the sidebar, which is exactly what "it doesn't
   look native" looks like. The panes must therefore paint nothing, and the
   parts that genuinely have to be opaque must follow the same rule the leaf
   does. `#drag` is a main-area leaf here and `#m-nav` is a sidebar one. */

const transparent = (v) => v === "transparent" || /,\s*0\)$/.test(v);

check(
	"the panes paint nothing, so the leaf's own colour shows through",
	transparent(after.paneBackground),
	after.paneBackground
);

const surfaces = await page.evaluate(() => {
	const read = (frame, sel) => {
		const el = document.querySelector(`${frame} ${sel}`);
		return el ? getComputedStyle(el).backgroundColor : null;
	};
	const frameBg = (f) => getComputedStyle(document.querySelector(f)).backgroundColor;
	return {
		mainLeaf: frameBg("#drag"),
		mainAdd: read("#drag", ".lv-add"),
		sideLeaf: frameBg("#m-nav"),
		sidePane: read("#m-nav", ".lv-pane"),
		sideRow: read("#m-nav", ".lv-nav-row"),
	};
});

check(
	"a sidebar leaf and a main-area leaf really are different colours here",
	surfaces.sideLeaf !== surfaces.mainLeaf,
	`sidebar=${surfaces.sideLeaf} main=${surfaces.mainLeaf}`
);
check(
	"an opaque bar matches the leaf it is sitting in, rather than a fixed colour",
	surfaces.mainAdd === surfaces.mainLeaf,
	`add=${surfaces.mainAdd} leaf=${surfaces.mainLeaf}`
);
check(
	"and in the sidebar the pane still paints nothing over it",
	transparent(surfaces.sidePane),
	String(surfaces.sidePane)
);
check(
	"a resting list row paints nothing either — core supplies its hover",
	transparent(surfaces.sideRow),
	String(surfaces.sideRow)
);

/* ---- 6. Nothing is left hardcoded ----
   The sweep. Every colour token the plugin could read is set to a value from
   one recognisable family, and then every painted colour in the view is checked
   against it. Anything outside is a value the theme cannot reach — which is the
   whole failure mode this section exists to catch, and it does not announce
   itself any other way. */
const PALETTE = [
	"--text-normal", "--text-muted", "--text-faint", "--text-accent",
	"--text-error", "--text-on-accent", "--text-selection",
	"--interactive-accent", "--interactive-accent-hover", "--interactive-normal",
	"--background-primary", "--background-primary-alt", "--background-secondary",
	"--background-secondary-alt", "--background-modifier-hover",
	"--background-modifier-active-hover", "--background-modifier-border",
	"--background-modifier-cover", "--divider-color",
	"--icon-color", "--icon-color-hover", "--icon-color-active", "--icon-color-focused",
	"--nav-item-color", "--nav-item-color-hover", "--nav-item-color-active",
	"--nav-item-color-selected", "--nav-item-background-hover",
	"--nav-item-background-active", "--nav-item-background-selected",
	"--checkbox-color", "--checkbox-color-hover", "--checkbox-border-color",
	"--checkbox-marker-color", "--checklist-done-color",
	"--color-red", "--color-orange", "--color-yellow", "--color-green",
	"--color-cyan", "--color-blue", "--color-purple", "--color-pink",
	"--color-base-00", "--color-base-100",
];

const strays = await page.evaluate(
	({ pane, tokens }) => {
		// Every token gets a green channel of exactly 111 — a value nothing in a
		// stylesheet would produce by accident.
		tokens.forEach((t, i) =>
			document.documentElement.style.setProperty(t, `rgb(${i}, 111, ${i})`)
		);

		const out = [];
		for (const el of document.querySelectorAll(`${pane} .lv-root, ${pane} .lv-root *`)) {
			// Inline styles come from the drag and keyboard code at runtime, not
			// from the stylesheet, so they are not what this is looking for.
			if (el.getAttribute("style")) continue;
			const cs = getComputedStyle(el);
			for (const prop of ["color", "backgroundColor", "borderTopColor", "borderLeftColor"]) {
				const val = cs[prop];
				if (!val) continue;
				// Fully transparent means nothing was painted.
				if (/rgba\([^)]*,\s*0\)$/.test(val) || val === "transparent") continue;
				const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(val);
				if (m && Number(m[2]) === 111) continue;
				out.push(`${(el.className || el.tagName).toString().slice(0, 40)} ${prop}=${val}`);
			}
		}
		return out;
	},
	{ pane: PANE, tokens: PALETTE }
);
check(
	"every colour in the view comes from a theme token",
	strays.length === 0,
	strays.length ? `${strays.length} hardcoded: ${[...new Set(strays)].join("\n     ")}` : "none"
);

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
