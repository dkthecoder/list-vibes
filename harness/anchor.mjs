/**
 * A scroller that stays where it was across a repaint.
 *
 * A scoped repaint replaces the pane wholesale, so the scroll offset has to be
 * carried over by hand. Carrying the pixel number is only right when nothing
 * above the viewport changed height — and the commonest repaint there is, a task
 * being ticked, changes it: the row leaves the open list for the completed
 * section. Restoring the old number then shows different content, and when the
 * list has become shorter than the offset the browser clamps it, which walks the
 * view toward the top a row at a time. That is the bug this guards.
 *
 * The real `swapPane` is driven here, not a copy of its arithmetic. The unit
 * tests cover the sums; what only a browser can answer is whether the measuring
 * around them agrees with how the rows are actually laid out.
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

/*
 * A pane shaped like the real one — `.lv-pane` wrapping a `.lv-scroll` of rows
 * carrying the identity the view gives them — built at a fixed row height so the
 * numbers in the assertions are the numbers on screen.
 */
await page.evaluate(() => {
	const host = document.createElement("div");
	host.id = "anchor-host";
	host.style.cssText = "position:fixed;left:-2000px;top:0;width:400px;height:200px;";
	document.body.appendChild(host);

	window.lvBuildPane = (host, keys) => {
		host.textContent = "";
		const pane = document.createElement("div");
		pane.className = "lv-pane";
		const scroll = document.createElement("div");
		scroll.className = "lv-scroll";
		scroll.style.cssText = "height:200px;overflow-y:auto;";
		for (const k of keys) {
			const row = document.createElement("div");
			row.className = "lv-task";
			row.dataset.lvKey = k;
			row.textContent = k;
			row.style.cssText = "height:40px;box-sizing:border-box;margin:0;padding:0;";
			scroll.appendChild(row);
		}
		pane.appendChild(scroll);
		host.appendChild(pane);
		return pane;
	};

	/** Where a row sits relative to the top edge of its scroller, on screen. */
	window.lvRowOffset = (pane, key) => {
		const sc = pane.querySelector(".lv-scroll");
		const row = sc.querySelector(`[data-lv-key="${key}"]`);
		if (!row) return null;
		return Math.round(row.getBoundingClientRect().top - sc.getBoundingClientRect().top);
	};
});

const TEN = Array.from({ length: 10 }, (_, i) => `a.md:${i}`);

/**
 * Scroll to `scrollTop`, swap the pane for one built from `after`, and report
 * where the row that was at the top edge ended up.
 */
async function swapAndMeasure(scrollTop, after) {
	return page.evaluate(
		({ scrollTop, after, before }) => {
			const host = document.getElementById("anchor-host");
			const pane = window.lvBuildPane(host, before);
			const sc = pane.querySelector(".lv-scroll");
			sc.scrollTop = scrollTop;
			// The row the reader is looking at, and where it sits, before anything moves.
			const rows = Array.from(sc.querySelectorAll("[data-lv-key]"));
			const box = sc.getBoundingClientRect();
			const watched = rows.find((r) => r.getBoundingClientRect().bottom > box.top);
			const key = watched.dataset.lvKey;
			const was = Math.round(watched.getBoundingClientRect().top - box.top);

			const next = window.lvSwapPane(pane, (parent) => {
				const built = window.lvBuildPane(document.createElement("div"), after);
				parent.appendChild(built);
			});

			return { key, was, now: window.lvRowOffset(next, key), scrollTop: next.querySelector(".lv-scroll").scrollTop };
		},
		{ scrollTop, after, before: TEN }
	);
}

/* ------------------------------------------------------------------
   1. A row removed above the viewport
   ------------------------------------------------------------------ */

let r = await swapAndMeasure(120, TEN.filter((k) => k !== "a.md:0"));
check(
	"a row removed above the viewport leaves the watched row where it was",
	r.now === r.was,
	`${r.key} was ${r.was}px, now ${r.now}px (scrollTop ${r.scrollTop})`
);
check(
	"and the scroller moved up by exactly the row that went",
	r.scrollTop === 80,
	`scrollTop ${r.scrollTop}, wanted 80`
);

/* ------------------------------------------------------------------
   2. A row added above the viewport
   ------------------------------------------------------------------ */

r = await swapAndMeasure(120, ["a.md:new", ...TEN]);
check(
	"a row added above the viewport leaves the watched row where it was",
	r.now === r.was,
	`${r.key} was ${r.was}px, now ${r.now}px (scrollTop ${r.scrollTop})`
);

/* ------------------------------------------------------------------
   3-5. Regression guards, not the fix

   Checks 1 and 2 are the ones that tell the two approaches apart — with
   the old pixel restore the watched row moves by exactly a row height.
   These three cover what must not break around it: a list cut shorter
   than the offset, the watched row going too, and an untouched pane. A
   scroller that genuinely cannot reach the old offset is clamped either
   way; that is the content being shorter, not a bug to fix.
   ------------------------------------------------------------------ */

r = await swapAndMeasure(240, TEN.slice(0, 7));
check(
	"a list cut short does not lose the watched row",
	r.now !== null,
	`${r.key} at ${r.now}px (scrollTop ${r.scrollTop})`
);
check(
	"and does not snap back to the top",
	r.scrollTop > 0,
	`scrollTop ${r.scrollTop}`
);

/* ------------------------------------------------------------------
   4. The watched row itself going
   ------------------------------------------------------------------ */

const gone = await page.evaluate((before) => {
	const host = document.getElementById("anchor-host");
	const pane = window.lvBuildPane(host, before);
	const sc = pane.querySelector(".lv-scroll");
	sc.scrollTop = 120;
	// Remove the anchor row and the two above it, so there is nothing to match.
	const after = before.filter((k) => !["a.md:1", "a.md:2", "a.md:3"].includes(k));
	const next = window.lvSwapPane(pane, (parent) => {
		parent.appendChild(window.lvBuildPane(document.createElement("div"), after));
	});
	return next.querySelector(".lv-scroll").scrollTop;
}, TEN);
check(
	"with the watched row gone it falls back to the old offset rather than the top",
	gone > 0,
	`scrollTop ${gone}`
);

/* ------------------------------------------------------------------
   5. An unscrolled pane is left alone
   ------------------------------------------------------------------ */

const top = await page.evaluate((before) => {
	const host = document.getElementById("anchor-host");
	const pane = window.lvBuildPane(host, before);
	const next = window.lvSwapPane(pane, (parent) => {
		parent.appendChild(window.lvBuildPane(document.createElement("div"), before));
	});
	return next.querySelector(".lv-scroll").scrollTop;
}, TEN);
check("a pane at the top stays at the top", top === 0, `scrollTop ${top}`);

/*
 * And stays there even when the row it would have anchored to moves.
 *
 * Reordering the top two rows makes the anchor row move down, and following it
 * would scroll the first row out of sight — a list reordering itself should not
 * also scroll. A scroller already at the very top has nothing above the viewport
 * to have changed, so there is nothing to correct for. Chromium's own scroll
 * anchoring declines to anchor at offset zero for the same reason.
 */
const topReorder = await page.evaluate((before) => {
	const host = document.getElementById("anchor-host");
	const pane = window.lvBuildPane(host, before);
	const next = window.lvSwapPane(pane, (parent) => {
		const swapped = [before[1], before[0], ...before.slice(2)];
		parent.appendChild(window.lvBuildPane(document.createElement("div"), swapped));
	});
	return next.querySelector(".lv-scroll").scrollTop;
}, TEN);
check(
	"a reorder at the top does not scroll the list",
	topReorder === 0,
	`scrollTop ${topReorder}`
);

/* ------------------------------------------------------------------
   6. A reordered row slides instead of appearing

   Starring a task lifts it into the band at the top. Without this the row
   is simply drawn there — the teleport. Each row that changed place is
   animated from where it used to be, so what the eye gets is the journey.
   ------------------------------------------------------------------ */

/**
 * Swap the pane for one with `after` in it and report, per key, the transform
 * each row was animated *from* — the lie that makes the slide.
 */
await page.evaluate(() => {
	/** What a row was animated *from*, counting only transform animations. */
	window.lvSlideFrom = (row) => {
		for (const a of row.getAnimations()) {
			const frames = a.effect.getKeyframes();
			if (frames.length && frames[0].transform !== undefined) return frames[0].transform;
		}
		return null;
	};
	window.lvMarkDragging = () => document.body.classList.add("lv-is-dragging");
	window.lvMarkLeaving = (pane) => {
		pane.querySelector('[data-lv-key="a.md:1"]').classList.add("is-leaving");
	};
});

async function slideFrom(before, after, prepName = null) {
	return page.evaluate(
		({ before, after, prepName }) => {
			const host = document.getElementById("anchor-host");
			const pane = window.lvBuildPane(host, before);
			if (prepName === "lvMarkDragging") window.lvMarkDragging();
			const next = window.lvSwapPane(pane, (parent) => {
				const built = window.lvBuildPane(document.createElement("div"), after);
				// The view marks a leaving row as it renders it, so the class is on the
				// *new* row by the time the slides are worked out. Mirror that.
				if (prepName === "lvMarkLeaving") window.lvMarkLeaving(built);
				parent.appendChild(built);
			});
			const out = {};
			for (const row of next.querySelectorAll("[data-lv-key]")) {
				// The transform animation specifically. A leaving row is already running
				// the CSS fade, which is an animation too and would otherwise read as a
				// slide that is not there.
				out[row.dataset.lvKey] = window.lvSlideFrom(row);
			}
			return out;
		},
		{ before, after, prepName }
	);
}

// b moves from 40 to 0, a moves from 0 to 40.
let slid = await slideFrom(TEN, ["a.md:1", "a.md:0", ...TEN.slice(2)]);
check(
	"a row lifted up the list slides down from where it was",
	slid["a.md:1"] === "translateY(40px)",
	`a.md:1 from ${slid["a.md:1"]}`
);
check(
	"and the row it displaced slides up from where it was",
	slid["a.md:0"] === "translateY(-40px)",
	`a.md:0 from ${slid["a.md:0"]}`
);
check(
	"a row that did not move is not animated at all",
	slid["a.md:5"] === null,
	`a.md:5 from ${slid["a.md:5"]}`
);

/* ------------------------------------------------------------------
   7. The four things it stays out of
   ------------------------------------------------------------------ */

// A row well past the fold: the scroller is 200px and the margin 120px, so
// row 9 at 360px is outside both and not worth animating.
slid = await slideFrom(TEN, ["a.md:9", ...TEN.slice(0, 9)]);
check(
	"a row far below the fold is left to appear where it lands",
	slid["a.md:8"] === null,
	`a.md:8 from ${slid["a.md:8"]}`
);



slid = await slideFrom(TEN, ["a.md:1", "a.md:0", ...TEN.slice(2)], "lvMarkLeaving");
check(
	"a row already leaving is not also slid",
	slid["a.md:1"] === null,
	`a.md:1 from ${slid["a.md:1"]}`
);

slid = await slideFrom(TEN, ["a.md:1", "a.md:0", ...TEN.slice(2)], "lvMarkDragging");
check(
	"nothing slides while a drag owns the transforms",
	Object.values(slid).every((v) => v === null),
	JSON.stringify(slid)
);
await page.evaluate(() => document.body.classList.remove("lv-is-dragging"));

const calm = await browser.newPage({
	viewport: { width: 1180, height: 900 },
	reducedMotion: "reduce",
});
await calm.goto(url);
await calm.waitForTimeout(200);
const calmSlid = await calm.evaluate((before) => {
	const host = document.createElement("div");
	host.id = "anchor-host";
	host.style.cssText = "position:fixed;left:-2000px;top:0;width:400px;height:200px;";
	document.body.appendChild(host);
	// Rebuilt here because this is a second page with its own document.
	const build = (host, keys) => {
		host.textContent = "";
		const pane = document.createElement("div");
		pane.className = "lv-pane";
		const scroll = document.createElement("div");
		scroll.className = "lv-scroll";
		scroll.style.cssText = "height:200px;overflow-y:auto;";
		for (const k of keys) {
			const row = document.createElement("div");
			row.className = "lv-task";
			row.dataset.lvKey = k;
			row.style.cssText = "height:40px;box-sizing:border-box;margin:0;padding:0;";
			scroll.appendChild(row);
		}
		pane.appendChild(scroll);
		host.appendChild(pane);
		return pane;
	};
	const pane = build(host, before);
	const next = window.lvSwapPane(pane, (parent) => {
		parent.appendChild(build(document.createElement("div"), [before[1], before[0], ...before.slice(2)]));
	});
	return Array.from(next.querySelectorAll("[data-lv-key]")).reduce((n, r) => n + r.getAnimations().length, 0);
}, TEN);
check("reduced motion means no slide at all, not a quicker one", calmSlid === 0, `${calmSlid} animations`);

/* ------------------------------------------------------------------ */

check("no page errors", errors.length === 0, errors.join(" | "));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
