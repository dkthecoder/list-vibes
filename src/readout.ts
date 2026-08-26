import { Notice } from "obsidian";
import {
	FoundRule,
	Sample,
	formatReport,
	rulesMentioning,
	viewportGap,
} from "./diagnostics";

/**
 * A readout you can photograph, for a phone with no cable attached.
 *
 * Temporary, and only while the mobile keyboard fault is open. Eight rounds of
 * this have been inference from a stylesheet read on a desktop; none of them
 * looked at the device. Remote debugging would settle it, but it wants a cable
 * and USB debugging turned on, so this is the version that needs neither: a
 * panel showing the handful of numbers that tell one explanation from another,
 * updated live, sized to be legible in a screenshot.
 *
 * Two properties make it work where nothing else would.
 *
 * It is appended to `document.body`, **outside `.app-container`** — the box that
 * holds Obsidian's own header and navigation bar, and the prime suspect for the
 * one that vanishes. Whatever happens inside that container, this is beside it
 * rather than in it, and `position: fixed` on the body keeps it on screen.
 *
 * And every rule here is an inline style rather than a class. One of the
 * experiments this exists to serve is running the plugin with its stylesheet
 * removed altogether, and a readout that went unstyled in exactly the
 * configuration being tested would be no use at all.
 */

/** What each reading would mean, so the screenshot needs no interpretation. */
const LEGEND =
	[
		"inner drops & gap stays 0 → the window resized (nothing to subtract)",
		"inner holds & gap grows → the visual viewport resized (subtract once)",
		"inner drops AND gap grows → both did it: the double count",
		"chain=none → nothing is capped, and the CSS theory is wrong",
	].join("\n");

export class KeyboardReadout {
	private el: HTMLElement | null = null;
	private timer: number | null = null;
	private win: Window;
	/** Highest keyboard height seen, so a screenshot taken late still shows it. */
	private peak = 0;
	/** Anything the guard caught, kept rather than flashed past. */
	private caught = new Set<string>();
	/**
	 * One sample per distinct keyboard state, not one per tick.
	 *
	 * The panel updates seven times a second; a report of every tick would be
	 * thousands of identical rows with the two that matter buried in them. A row
	 * is kept when the shape of the viewport changes, which is exactly when
	 * something worth reading happened.
	 */
	private samples: Sample[] = [];
	private lastShape = "";
	/** Writes the report into the vault. Supplied by the plugin. */
	private write: ((body: string) => void) | null = null;

	constructor(win: Window, write?: (body: string) => void) {
		this.win = win;
		this.write = write ?? null;
	}

	get open(): boolean {
		return this.el !== null;
	}

	toggle(): void {
		if (this.el) this.close();
		else this.show();
	}

	show(): void {
		if (this.el) return;
		const doc = this.win.document;
		const el = doc.createElement("div");
		el.style.cssText = [
			"position:fixed",
			"left:8px",
			"right:8px",
			"top:8px",
			// Above everything, including modals, so it is never the thing hidden.
			"z-index:2147483647",
			"background:#101418",
			"color:#e6edf3",
			"border:2px solid #4c8eda",
			"border-radius:8px",
			"padding:8px 10px",
			"font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace",
			// It must never swallow a tap meant for the field being tested.
			"pointer-events:none",
			"white-space:pre-wrap",
			"word-break:break-word",
		].join(";");
		doc.body.appendChild(el);
		this.el = el;

		this.peak = 0;
		this.caught.clear();
		this.samples = [];
		this.lastShape = "";
		this.tick();
		this.timer = this.win.setInterval(() => this.tick(), 150);
		new Notice("Readout on. Tap a field, let the keyboard settle, screenshot.", 6000);
	}

	close(): void {
		if (this.timer !== null) this.win.clearInterval(this.timer);
		this.timer = null;
		this.el?.remove();
		this.el = null;
		// The report is most useful on the way out, when both a resting sample
		// and a typing one have been seen.
		this.report();
	}

	/**
	 * Write what has been collected into the vault.
	 *
	 * A note rather than a screenshot: a vault syncs, and a table of fourteen
	 * numbers per row is not something anybody should have to transcribe from a
	 * photograph of a tablet.
	 */
	report(): void {
		if (!this.write) return;
		const doc = this.win.document;
		const rules: FoundRule[] = rulesMentioning(
			Array.from(doc.styleSheets) as never,
			"keyboard-height"
		);
		const app = doc.querySelector(".app-container");
		const matching: string[] = [];
		if (app) {
			for (const sheet of Array.from(doc.styleSheets)) {
				let list: CSSRuleList | undefined;
				try {
					list = sheet.cssRules;
				} catch {
					continue;
				}
				for (let i = 0; i < list.length && matching.length < 40; i++) {
					const sel = (list[i] as CSSStyleRule).selectorText;
					if (!sel) continue;
					try {
						if (app.matches(sel)) matching.push(list[i].cssText);
					} catch {
						// An unsupported selector is not a match and not an error.
					}
				}
			}
		}
		this.write(formatReport(rules, matching, this.samples));
	}

	/** Called by the scroll guard so a catch survives long enough to photograph. */
	noteCatch(what: string): void {
		this.caught.add(what);
	}

	private tick(): void {
		if (!this.el) return;
		const win = this.win;
		const doc = win.document;
		const de = doc.documentElement;
		const vv = win.visualViewport;

		const px = (el: Element | null) =>
			el ? Math.round(el.getBoundingClientRect().height) : -1;
		const cssVar = (name: string) =>
			win.getComputedStyle(de).getPropertyValue(name).trim() || "0";

		const app = doc.querySelector(".app-container");
		/*
		 * Both readings of the keyboard, kept apart on purpose. `--keyboard-height`
		 * is only visible here if Obsidian declares it on the document element;
		 * the cap it produces is measurable wherever it is declared. A screenshot
		 * showing `kb=0 short=645` is the whole answer to why a detection that
		 * depends on the variable never fired.
		 */
		const kb = Math.round(parseFloat(cssVar("--keyboard-height")) || 0);
		const maxH = app ? parseFloat(win.getComputedStyle(app).maxHeight) : NaN;
		const short = Number.isFinite(maxH)
			? Math.round(win.innerHeight - maxH)
			: 0;
		if (kb > this.peak) this.peak = kb;

		// Every ancestor of the caret that is holding an offset. This is the
		// reading that separates "the container collapsed" from "something
		// scrolled it", which are different bugs with different fixes.
		const scrolled: string[] = [];
		let node: Element | null = doc.activeElement;
		while (node && node !== doc.body) {
			if (node.scrollTop) {
				const cs = win.getComputedStyle(node);
				const name = String(node.className || node.tagName).split(" ")[0].slice(0, 24);
				scrolled.push(`${name}=${Math.round(node.scrollTop)}(${cs.overflowY})`);
			}
			node = node.parentElement;
		}
		if (de.scrollTop || win.scrollY) scrolled.push(`page=${Math.round(de.scrollTop || win.scrollY)}`);

		/*
		 * Every ancestor of the view that is materially shorter than the viewport,
		 * which is the reading the measured fix acts on. `chain=none` with the
		 * keyboard up and `inner` below its resting height would mean the app is
		 * not being shortened at all and the whole diagnosis is wrong.
		 */
		const lv = doc.querySelector(".lv-root");
		const shortened = [];
		for (let n = lv; n && n !== doc.body; n = n.parentElement) {
			const h = Math.round(n.getBoundingClientRect().height);
			if (win.innerHeight - h >= 120) {
				shortened.push(`${String(n.className || n.tagName).split(" ")[0].slice(0, 18)}=${h}`);
			}
		}
		const chain = shortened.length ? shortened.join(" ") : "none";

		const active = doc.activeElement;
		const focused = active
			? `${active.tagName.toLowerCase()}.${String(active.className || "").split(" ")[0].slice(0, 20)}`
			: "none";

		/*
		 * A `100vh` and a `100dvh` box, measured rather than assumed.
		 *
		 * These are the two readings that separate the explanations. On a WebView
		 * the Activity has resized, `vh` shrinks with the window and equals
		 * `inner`. If instead the WebView has resized only the *visual* viewport
		 * — which every WebView does from M139, independently of the Activity —
		 * then `vh` stays at its resting value and `vv` is the one that drops.
		 * Both dropping by a keyboard each is the double-count fingerprint.
		 */
		const probe = doc.createElement("div");
		probe.style.cssText =
			"position:fixed;top:0;left:0;width:1px;height:100vh;pointer-events:none;visibility:hidden;";
		doc.body.appendChild(probe);
		const vh = Math.round(probe.getBoundingClientRect().height);
		probe.style.height = "100dvh";
		const dvh = Math.round(probe.getBoundingClientRect().height);
		probe.remove();

		/*
		 * A row per change of shape, not per tick. `at` is a tick counter rather
		 * than a clock: what matters is the order and the transition, and a
		 * wall-clock time on a tablet adds a column nobody reads.
		 */
		const shape = [
			win.innerHeight,
			Math.round(vv?.height ?? 0),
			kb,
			px(app),
		].join("/");
		if (shape !== this.lastShape) {
			this.lastShape = shape;
			this.samples.push({
				at: `t${this.samples.length}`,
				innerHeight: win.innerHeight,
				clientHeight: de.clientHeight,
				vh,
				dvh,
				visual: Math.round(vv?.height ?? 0),
				offsetTop: Math.round(vv?.offsetTop ?? 0),
				scale: vv?.scale ?? 1,
				keyboardVar: kb,
				appHeight: px(app),
				appMaxHeight: app ? win.getComputedStyle(app).maxHeight : "—",
				shortened,
				bodyClass: doc.body.className,
			});
			// A cap, so a readout left on all day cannot grow without bound.
			if (this.samples.length > 200) this.samples.splice(0, 100);
			/*
			 * Written on every change of shape, not only on the way out.
			 *
			 * The fault being diagnosed is one where the whole app disappears, so
			 * "toggle it off afterwards" is an instruction that assumes the thing
			 * under test behaves. A handful of writes per keyboard is cheap, and
			 * it means the report survives a crash, a force-quit, or simply
			 * forgetting.
			 */
			this.report();
		}

		this.el.setText(
			[
				`app h=${px(app)} cap=${app ? win.getComputedStyle(app).maxHeight : "—"}`,
				`kb=${kb} peak=${this.peak} short=${short}`,
				`inner=${win.innerHeight} client=${de.clientHeight} vh=${vh} dvh=${dvh}`,
				vv
					? `vv=${Math.round(vv.height)} top=${Math.round(vv.offsetTop)} scale=${vv.scale} gap=${viewportGap({ innerHeight: win.innerHeight, visual: Math.round(vv.height) })}`
					: "vv=(none)",
				`body=${doc.body.className.slice(0, 140)}`,
				`chain=${chain}`,
				`focus=${focused}`,
				`scrolled=${scrolled.length ? scrolled.join(" ") : "none"}`,
				`guard=${this.caught.size ? [...this.caught].join(" ") : "quiet"}`,
				LEGEND,
			].join("\n")
		);
	}
}
