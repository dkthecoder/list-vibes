import { Notice } from "obsidian";

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
		"app h=0 → the container collapsed",
		"kb=0 but short>0 → the variable is not on :root",
		"short ≈ inner/2 → the keyboard is off twice",
		"scrolled=… → something scrolled it",
	].join(" · ");

export class KeyboardReadout {
	private el: HTMLElement | null = null;
	private timer: number | null = null;
	private win: Window;
	/** Highest keyboard height seen, so a screenshot taken late still shows it. */
	private peak = 0;
	/** Anything the guard caught, kept rather than flashed past. */
	private caught = new Set<string>();

	constructor(win: Window) {
		this.win = win;
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
		this.tick();
		this.timer = this.win.setInterval(() => this.tick(), 150);
		new Notice("Readout on. Tap a field, let the keyboard settle, screenshot.", 6000);
	}

	close(): void {
		if (this.timer !== null) this.win.clearInterval(this.timer);
		this.timer = null;
		this.el?.remove();
		this.el = null;
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

		const active = doc.activeElement;
		const focused = active
			? `${active.tagName.toLowerCase()}.${String(active.className || "").split(" ")[0].slice(0, 20)}`
			: "none";

		this.el.setText(
			[
				`app h=${px(app)} cap=${app ? win.getComputedStyle(app).maxHeight : "—"}`,
				`kb=${kb} peak=${this.peak} short=${short} inner=${win.innerHeight}`,
				vv
					? `vv=${Math.round(vv.height)} top=${Math.round(vv.offsetTop)} scale=${vv.scale}`
					: "vv=(none)",
				`body=${doc.body.className.slice(0, 140)}`,
				`focus=${focused}`,
				`scrolled=${scrolled.length ? scrolled.join(" ") : "none"}`,
				`guard=${this.caught.size ? [...this.caught].join(" ") : "quiet"}`,
				LEGEND,
			].join("\n")
		);
	}
}
