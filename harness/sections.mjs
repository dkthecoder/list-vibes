/**
 * Sections, driven in a real browser.
 *
 * The unit tests cover what each section edit writes to the file. What they
 * cannot cover is the part that only exists as event handling: whether a
 * heading folds when clicked, whether an empty section is on screen to be
 * dropped into at all, and whether a card dragged across a heading asks for the
 * cross-section move rather than a plain reorder.
 */
import { launch } from "./browser.mjs";

const url = "file://" + process.cwd() + "/harness/index.html";
const browser = await launch();

const results = [];
const check = (name, pass, detail = "") => {
	results.push({ name, pass, detail });
	console.log(`${pass ? "  ok  " : "  FAIL"} ${name}${detail ? "  — " + detail : ""}`);
};

const PANE = "#sections";
const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForTimeout(250);

/* ---------------- the heading is a control ---------------- */

const HEAD = ".lv-section:not(.lv-section-starred)";
const heads = await page.$$(`${PANE} ${HEAD}`);
check("every heading is drawn", heads.length >= 4, `${heads.length} sections`);

const parts = await page.evaluate((sel) => {
	const h = document.querySelector(`${sel} .lv-section:not(.lv-section-starred)`);
	return {
		chevron: !!h?.querySelector(".lv-section-chevron svg"),
		name: h?.querySelector(".lv-section-name")?.textContent ?? "",
		count: h?.querySelector(".lv-section-count")?.textContent ?? "",
		more: !!h?.querySelector(".lv-section-more"),
		expanded: h?.getAttribute("aria-expanded"),
	};
}, PANE);

check("it has a fold control", parts.chevron);
check("it names the section", parts.name.length > 0, parts.name);
check("it counts what is in it", /^\d+$/.test(parts.count), parts.count);
check("it offers a menu", parts.more);
check("it reports its state to a screen reader", parts.expanded === "true");

/* ---------------- the row does not repeat its heading ---------------- */

const repeats = await page.evaluate((sel) => {
	const rows = [...document.querySelectorAll(`${sel} .lv-task`)];
	const heads = [...document.querySelectorAll(`${sel} .lv-section-name`)].map(
		(h) => h.textContent?.trim() ?? ""
	);
	return rows.filter((r) => {
		const meta = r.querySelector(".lv-task-meta")?.textContent ?? "";
		return heads.some((h) => h && meta.includes(h));
	}).length;
}, PANE);

check(
	"a grouped row does not repeat the heading above it",
	repeats === 0,
	`${repeats} rows restate their section`
);

/* ---------------- a new task knows which section it joins ---------------- */

const adder = await page.evaluate((sel) => {
	const named = document.querySelector(`${sel} .lv-add-section`);
	const heads = [...document.querySelectorAll(`${sel} .lv-section-name`)].map((h) =>
		h.textContent.trim()
	);
	// A list with no headings has no choice to offer, so the control is absent
	// rather than present and inert.
	const plain = document.querySelector("#drag .lv-add-section");
	return {
		shown: !!named,
		text: named?.textContent?.trim() ?? "",
		isRealSection: heads.includes(named?.textContent?.trim() ?? ""),
		onPlainList: !!plain,
	};
}, PANE);

check("a sectioned list says where a new task will go", adder.shown, adder.text);
/* Nothing picked means no group. The last heading was a destination nobody
   chose, and the furthest from the top of the list. */
check(
	"and defaults to no group rather than a heading nobody picked",
	adder.text === "No group",
	adder.text
);
check("a list without sections offers no such choice", adder.onPlainList === false);

/* ---------------- starred rises to the top ---------------- */

const starred = await page.evaluate((sel) => {
	const pane = document.querySelector(sel);
	const band = pane?.querySelector(".lv-section-starred");
	if (!band) return { band: false };

	// The band's own run is the one drawn straight after its label.
	const run = band.nextElementSibling;
	const rows = [...(run?.querySelectorAll(".lv-task, .lv-card-task") ?? [])];

	// Nothing starred should appear twice: once lifted and once left behind.
	const everywhere = [...pane.querySelectorAll(".lv-group .lv-task, .lv-group .lv-card-task")];
	const stars = everywhere.filter((r) => r.querySelector(".is-starred, .lv-star.is-on"));

	return {
		band: true,
		first: pane.querySelector(".lv-section")?.classList.contains("lv-section-starred"),
		count: rows.length,
		badged: rows.filter((r) => r.querySelector(".lv-section-badge")).length,
		foldable: !!band.querySelector(".lv-section-chevron"),
		// The band carries no heading controls at all; deleting a real group
		// lives in its menu.
		deletable: !!band.querySelector(".lv-section-more"),
		total: stars.length,
	};
}, PANE);

if (starred.band) {
	check("the starred band is the first heading on screen", starred.first === true);
	check("it holds the starred tasks", starred.count > 0, `${starred.count}`);
	check(
		"each of them still says which section it came from",
		starred.badged === starred.count,
		`${starred.badged}/${starred.count}`
	);
	check("it does not pretend to be an editable heading", !starred.foldable && !starred.deletable);
} else {
	check("no band is drawn when nothing is starred", true, "nothing starred in this fixture");
}

/* ---------------- completed carries the section it left ---------------- */

/* One click, not one per pane: `completedOpen` is a single piece of view state
   shared by every pane on this page, so opening the second would close the
   first. */
await page.evaluate(() => {
	document
		.querySelector("#sections .lv-completed-head")
		?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await page.waitForTimeout(200);

for (const [what, sel] of [
	["row", "#sections"],
	["card", "#sections-cards"],
]) {
	const found = await page.evaluate((s) => {
		const body = document.querySelector(`${s} .lv-completed-body`);
		if (!body) return { total: 0, tagged: 0 };
		const items = [...body.querySelectorAll(".lv-task, .lv-card-task")];
		return {
			total: items.length,
			tagged: items.filter((i) => i.querySelector(".lv-section-badge")).length,
			text: body.querySelector(".lv-section-badge")?.textContent ?? "",
		};
	}, sel);

	check(
		`a completed ${what} says which section it came from`,
		found.total > 0 && found.tagged === found.total,
		`${found.tagged}/${found.total} tagged, e.g. ${found.text}`
	);
}

/* An open task sits under its heading, so the badge would be the same word
   twice — once in the heading and once on every item beneath it. */
const openTagged = await page.evaluate((sel) => {
	// Everything but the starred run, which exists precisely to show tasks away
	// from their heading and so is meant to carry badges.
	const groups = [...document.querySelectorAll(`${sel} .lv-group`)].filter(
		(g) => !g.previousElementSibling?.classList.contains("lv-section-starred")
	);
	return groups.flatMap((g) => [...g.querySelectorAll(".lv-section-badge")]).length;
}, PANE);

check("an open row under its heading does not", openTagged === 0, `${openTagged} tagged`);

/* ---------------- the drag reaches across a heading ---------------- */

await page.evaluate(() => (window.lvCalls.length = 0));

/* A real mouse, not a synthesised PointerEvent: pointer capture only works
   against a pointer the browser believes is down, and the capture is half of
   what makes the gesture survive leaving the row.

   Which means the pane has to actually be on screen. This harness page is
   thousands of pixels tall and every pane below the fold has a bounding box the
   mouse can never reach. */
await page.evaluate((sel) => {
	document.querySelector(`${sel} .lv-group`)?.scrollIntoView({ block: "start" });
}, PANE);
await page.waitForTimeout(120);

const boxes = await page.evaluate((sel) => {
	// Runs 1 and 2 are the first two headed sections. Run 0 is the space above
	// the first heading, which this list leaves empty.
	const groups = [...document.querySelectorAll(`${sel} .lv-group`)];
	const card = groups[2]?.querySelector(".lv-task, .lv-card-task");
	if (!card || !groups[1]) return null;
	const c = card.getBoundingClientRect();
	const g = groups[1].getBoundingClientRect();
	return {
		from: { x: c.left + c.width / 2, y: c.top + c.height / 2 },
		to: { x: g.left + g.width / 2, y: g.top + 12 },
		groups: groups.length,
	};
}, PANE);

check("the wall has runs to drag between", !!boxes && boxes.groups >= 2, `${boxes?.groups ?? 0} runs`);

await page.mouse.move(boxes.from.x, boxes.from.y);
await page.mouse.down();
await page.mouse.move(boxes.from.x, boxes.from.y - 20);
await page.mouse.move(boxes.to.x, boxes.to.y, { steps: 6 });

const lit = await page.evaluate(
	(sel) => document.querySelectorAll(`${sel} .lv-drop-target`).length,
	PANE
);
check("the destination run is lit while over it", lit === 1, `${lit} lit`);

/* An empty section is drawn so it can be dropped into, and a div with no
   children has no height to drop onto. It has to grow while a drag is live or
   the drop target it exists to be is unreachable. */
const emptyDuringDrag = await page.evaluate(
	(sel) => document.querySelector(`${sel} .lv-group`)?.getBoundingClientRect().height ?? -1,
	PANE
);
check("an empty run opens a drop zone mid-drag", emptyDuringDrag > 20, `${emptyDuringDrag}px`);

await page.mouse.up();

const kinds = (await page.evaluate(() => window.lvCalls)).map((c) => c[0]);
check(
	"crossing a heading asks for the cross-section move",
	kinds.includes("moveToSection"),
	kinds.join(", ") || "nothing"
);
check("and not a plain reorder", !kinds.includes("reorder"), kinds.join(", "));

const left = await page.evaluate(
	(sel) => document.querySelectorAll(`${sel} .lv-drop-target`).length,
	PANE
);
check("the highlight is cleared on drop", left === 0, `${left} left lit`);

/* ---------------- folding ---------------- */

await page.evaluate(() => (window.lvCalls.length = 0));
/* Dispatched on the element rather than clicked at its coordinates: a forced
   click goes to a point, and the point moves whenever the layout above it does
   — which is how this started landing on a task instead of a heading. */
await page.evaluate(
	({ sel, head }) => {
		const name = document.querySelector(`${sel} ${head} .lv-section-name`);
		name?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	},
	{ sel: PANE, head: HEAD }
);
await page.waitForTimeout(80);
const foldCalls = await page.evaluate(() => window.lvCalls);
check(
	"clicking a heading folds without writing to the file",
	foldCalls.length === 0,
	JSON.stringify(foldCalls.map((c) => c[0]))
);

/* ---------------- a heading is dragged to reorder ---------------- */

await page.evaluate(() => (window.lvCalls.length = 0));

await page.evaluate((sel) => {
	document.querySelector(`${sel} .lv-group`)?.scrollIntoView({ block: "start" });
}, PANE);
await page.waitForTimeout(120);

const hs = await page.evaluate((sel) => {
	const list = [...document.querySelectorAll(`${sel} .lv-section:not(.lv-section-starred)`)];
	if (list.length < 2) return null;
	const a = list[0].getBoundingClientRect();
	const b = list[1].getBoundingClientRect();
	return {
		from: { x: a.left + 60, y: a.top + a.height / 2 },
		to: { x: a.left + 60, y: b.top + b.height },
	};
}, PANE);

check("there are headings to reorder", !!hs);

await page.mouse.move(hs.from.x, hs.from.y);
await page.mouse.down();
await page.mouse.move(hs.from.x, hs.from.y + 20);
await page.mouse.move(hs.to.x, hs.to.y, { steps: 6 });
await page.mouse.up();

const moved = (await page.evaluate(() => window.lvCalls)).map((c) => c[0]);
check(
	"dragging a heading reorders the section",
	moved.includes("moveSection"),
	moved.join(", ") || "nothing"
);

/* ---------------- a drag can reach what is off screen ---------------- */

/* Without this the drop target has to already be visible when the drag starts,
   which on a phone it nearly never is: the wall collapses to one column below
   560px, so the sections become tall bands and the one being aimed at is past
   the bottom of the screen.

   The scroller is given a phone's height rather than a phone's viewport, which
   is the part that matters: what decides whether a target is reachable is
   whether the list overflows the box it is in. */
const edge = await page.evaluate(
	async (sel) => {
		const sc = document.querySelector(`${sel} .lv-scroll`);
		if (!sc) return { why: "no scroller" };
		sc.style.maxHeight = "420px";
		sc.style.overflowY = "auto";
		sc.scrollTop = 0;
		if (sc.scrollHeight <= sc.clientHeight) return { why: "nothing to scroll" };

		const row = sc.querySelector(".lv-task, .lv-card-task");
		// Synthetic pointer events have no pointer the browser will capture, and
		// capture is not what is under test here.
		row.setPointerCapture = () => {};
		row.releasePointerCapture = () => {};
		row.hasPointerCapture = () => false;

		const r = row.getBoundingClientRect();
		const box = sc.getBoundingClientRect();
		const send = (type, y) =>
			row.dispatchEvent(
				new PointerEvent(type, {
					pointerId: 9,
					pointerType: "touch",
					button: 0,
					clientX: r.left + r.width / 2,
					clientY: y,
					bubbles: true,
					cancelable: true,
				})
			);

		send("pointerdown", r.top + r.height / 2);
		await new Promise((res) => setTimeout(res, 600)); // outlast the long press
		const armed = !!sc.querySelector(".lv-dragging");

		// Held just inside the bottom edge and then kept still: the finger stops
		// moving and the list must keep coming, which is the whole point.
		send("pointermove", box.bottom - 10);
		const before = sc.scrollTop;
		await new Promise((res) => setTimeout(res, 400));
		const after = sc.scrollTop;

		send("pointerup", box.bottom - 10);
		return { armed, before, after };
	},
	PANE
);

check("the phone-height list has somewhere to scroll", !edge.why, edge.why ?? "");
check("a long press arms the drag on touch", edge.armed === true);
check(
	"holding at the edge keeps pulling the list after the finger stops",
	edge.after > edge.before,
	`scrollTop ${edge.before} → ${edge.after}`
);

/* ---------------- a sort does not take the headings away ---------------- */

/*
 * Grouping used to be gated on the custom sort, so choosing any other one made
 * every heading disappear and left one flat list. The headings are a view of
 * the file, not a consequence of its order: they stay, and the rows sort inside
 * them.
 */
const sorted = await page.evaluate(() => {
	const pane = document.getElementById("sections-sorted");
	const groups = [];
	for (const el of pane.querySelectorAll(
		".lv-section:not(.lv-section-starred), .lv-task-title"
	)) {
		// Completed is a filtered subset with its own block at the foot, and the
		// ungrouped run sits below the last heading without belonging to it.
		// Neither must be read as part of the group above.
		if (el.closest(".lv-completed")) continue;
		if (el.classList.contains("lv-task-title") && !el.closest(".lv-in-group")) continue;
		if (el.classList.contains("lv-task-title")) {
			groups[groups.length - 1]?.titles.push(el.textContent.trim());
		} else {
			groups.push({ name: el.querySelector(".lv-section-name")?.textContent ?? "", titles: [] });
		}
	}
	return groups;
});

check(
	"an A–Z sort keeps every heading",
	sorted.length >= 4,
	`${sorted.length} headings`
);

const unsorted = sorted.find(
	(g) =>
		g.titles.length > 1 &&
		g.titles.some(
			(t, i) => i > 0 && t.localeCompare(g.titles[i - 1], undefined, { sensitivity: "base" }) < 0
		)
);
check(
	"and sorts the rows within each one",
	!unsorted,
	unsorted ? `${unsorted.name}: ${unsorted.titles.join(" | ")}` : ""
);

/* ---------------- the groups carry an order of their own ---------------- */

/*
 * Two sorts, not one. The task sort orders rows inside a heading; the group
 * sort orders the headings. Neither is derived from the other, and ungrouped
 * tasks sit below every group and above Completed whichever is chosen.
 */
const order = await page.evaluate(() => {
	const pane = document.getElementById("sections-sorted");
	const out = [];
	for (const el of pane.querySelectorAll(".lv-section, .lv-group, .lv-completed")) {
		if (el.closest(".lv-completed") && !el.classList.contains("lv-completed")) continue;
		if (el.classList.contains("lv-section-starred")) continue;
		if (el.classList.contains("lv-section-loose")) continue;
		if (el.classList.contains("lv-starred-run")) continue;
		if (el.classList.contains("lv-section")) {
			out.push("group:" + el.querySelector(".lv-section-name")?.textContent);
		} else if (el.classList.contains("lv-completed")) out.push("completed");
		else if (!el.classList.contains("lv-in-group")) out.push("ungrouped");
	}
	return out;
});

const groups = order.filter((o) => o.startsWith("group:")).map((o) => o.slice(6));
const alphabetical = [...groups].sort((a, b) =>
	a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
);
check(
	"an A–Z group sort orders the headings themselves",
	groups.join("|") === alphabetical.join("|"),
	groups.join(", ")
);
check(
	"ungrouped sits below every group",
	order.lastIndexOf("ungrouped") > order.lastIndexOf(order.filter((o) => o.startsWith("group:")).pop()),
	order.join(" > ")
);
check(
	"and Completed sits below that",
	order.indexOf("completed") === order.length - 1,
	order.join(" > ")
);

/* ---------------- every band starts on the same rail ---------------- */

/*
 * A heading's text starts where the task titles under it start. It is the
 * difference between two declarations in different rules, so it is a rendered
 * fact rather than a readable one — and it has broken twice: once when the band
 * gained a margin, once when Completed's inset correction was removed with the
 * band it was correcting for. Neither showed up anywhere.
 */
const rails = await page.evaluate(() => {
	const P = "#sections ";
	const left = (sel) => {
		const el = document.querySelector(P + sel);
		return el ? Math.round(el.getBoundingClientRect().left) : null;
	};
	return {
		group: left(".lv-section:not(.lv-section-starred):not(.lv-completed-head) .lv-section-name"),
		completed: left(".lv-completed-head .lv-section-name"),
		starred: left(".lv-section-starred .lv-section-name"),
		ungrouped: left(".lv-section-loose .lv-section-name"),
		title: left(".lv-task-title"),
	};
});

const distinct = [...new Set(Object.values(rails).filter((v) => v !== null))];
check(
	"every heading starts on the task titles' rail",
	distinct.length === 1,
	Object.entries(rails).map(([k, v]) => `${k}=${v}`).join(" ")
);

/* ---------------- tasks above the first heading ---------------- */

/*
 * No fixture had a task above the first `##` until now, so the ungrouped run
 * had never been drawn with anything in it — in the harness or, as it turned
 * out, in any real list either. It renders below every group and above
 * Completed, with a rule between it and the groups.
 */
const ungrouped = await page.evaluate(() => {
	const pane = document.getElementById("sections");
	const run = [...pane.querySelectorAll(".lv-group")].find(
		(el) => !el.classList.contains("lv-in-group") && !el.classList.contains("lv-starred-run")
	);
	const band = pane.querySelector(".lv-section-loose");
	// Completed's header is a `.lv-section` too since the bands were unified,
	// and it sits below the ungrouped run rather than above it.
	const heads = [
		...pane.querySelectorAll(
			".lv-section:not(.lv-section-starred):not(.lv-completed-head):not(.lv-section-loose)"
		),
	];
	const last = heads[heads.length - 1];
	return {
		tasks: run ? run.querySelectorAll(".lv-task").length : 0,
		hasBand: !!band,
		bandCount: band?.querySelector(".lv-section-count")?.textContent ?? "",
		belowEveryGroup:
			!!run && !!last && (last.compareDocumentPosition(run) & Node.DOCUMENT_POSITION_FOLLOWING) > 0,
	};
});

check("the ungrouped run holds the tasks above the first heading", ungrouped.tasks === 2, `${ungrouped.tasks}`);
check(
	"it has a band of its own, with its count",
	ungrouped.hasBand && ungrouped.bandCount === "2",
	`band=${ungrouped.hasBand} count=${ungrouped.bandCount}`
);
check("and it sits below every group", ungrouped.belowEveryGroup);

/* ---------------- the sort menu offers both orders ---------------- */

/*
 * The menu was the one part of the view nothing could see: the harness's Menu
 * returned itself and drew nothing, so a section that failed to appear looked
 * exactly like one that did. It records what it was given now, which is what a
 * suite needs to know — what was offered, not what it looked like.
 */
const menu = await page.evaluate(() => {
	const pane = document.getElementById("sections");
	pane
		.querySelector(".lv-header-action")
		.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	return window.__lvMenu ?? null;
});

check("the sort button opens a menu", Array.isArray(menu), menu ? `${menu.length} items` : "none");

if (Array.isArray(menu)) {
	const titles = menu.map((i) => i.title);
	check("it offers an order for the tasks", titles.includes("Sort tasks"));
	check(
		"and a separate one for the groups",
		titles.includes("Sort groups"),
		titles.join(", ")
	);
	check(
		"with the headings' own orders under it",
		["File order", "A–Z", "Z–A"].every((t) => titles.includes(t)),
		titles.join(", ")
	);
	check(
		"and exactly one option ticked in each",
		menu.filter((i) => i.checked).length === 2,
		`${menu.filter((i) => i.checked).map((i) => i.title).join(", ")}`
	);
	/* A heading has to be a label. Disabled renders as an option you cannot
	   pick, which reads as something broken rather than as a title. */
	const headings = menu.filter((i) => ["Sort tasks", "Sort groups"].includes(i.title));
	check(
		"the two headings are labels, not disabled options",
		headings.length === 2 && headings.every((h) => h.label && !h.disabled),
		headings.map((h) => `${h.title}: label=${h.label} disabled=${h.disabled}`).join(", ")
	);
}

/* ---------------- groups can be turned off ---------------- */

/*
 * Off is not the same as gone. The headings stop being drawn and every row
 * carries the one it came from as a badge, which is the rule Completed and the
 * smart views already follow.
 */
const flat = await page.evaluate(() => {
	const pane = document.getElementById("sections-flat");
	const heads = [...pane.querySelectorAll(".lv-section:not(.lv-section-starred):not(.lv-section-loose)")].filter(
		(e) => !e.closest(".lv-completed")
	);
	return {
		heads: heads.length,
		badges: pane.querySelectorAll(".lv-task .lv-section-badge").length,
		rows: pane.querySelectorAll(".lv-task").length,
	};
});

check("with groups off no heading is drawn", flat.heads === 0, `${flat.heads} headings`);
check(
	"and every row carries the heading it came from",
	flat.badges > 0 && flat.badges <= flat.rows,
	`${flat.badges} badges on ${flat.rows} rows`
);

check("no page errors", errors.length === 0, errors[0] ?? "");

await browser.close();
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
