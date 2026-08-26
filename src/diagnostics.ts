import { App, Notice, TFile } from "obsidian";

/**
 * Measure what the phone is actually doing when the keyboard opens.
 *
 * Three attempts at the mobile keyboard fault have been wrong, and each was
 * wrong in the same way: a plausible cause, a fix aimed at it, and no way to
 * tell from here whether the cause was real. A browser on a desktop does not
 * have a soft keyboard, and no harness reproduces one — the numbers only exist
 * on the device where the fault happens.
 *
 * So this records them there. It is not a fix and it is not instrumentation
 * that stays on: it is a command the user runs once, a field they tap, and a
 * note in the vault with every measurement that could distinguish one cause
 * from another. It syncs back like any other note.
 *
 * Nothing here reads any content. The report contains element sizes, scroll
 * offsets and CSS variables — no task text, no file names, no note bodies.
 */

interface Sample {
	/** Milliseconds since recording started. */
	t: number;
	event: string;
	values: Record<string, string | number>;
}

/** A rectangle, rounded, or a dash where the element is not there at all. */
function rect(el: Element | null): string {
	if (!el) return "—";
	const r = el.getBoundingClientRect();
	return `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)}`;
}

function cssVar(el: Element | null, name: string, win: Window): string {
	if (!el) return "—";
	const v = win.getComputedStyle(el).getPropertyValue(name).trim();
	return v || "(unset)";
}

/**
 * Every ancestor of the focused element that has been scrolled, and whether it
 * can be scrolled back.
 *
 * This is the one measurement that separates "the view was scrolled out of
 * sight" from "the view got shorter". An `overflow: hidden` box that has been
 * scrolled has no scrollbar, so from the user's side it looks exactly like
 * content that vanished.
 */
function scrolledAncestors(active: Element | null, win: Window): string {
	if (!active) return "(nothing focused)";
	const out: string[] = [];
	let node: Element | null = active;
	while (node && node !== win.document.body) {
		if (node.scrollTop !== 0 || node.scrollLeft !== 0) {
			const overflow = win.getComputedStyle(node).overflowY;
			const name = node.className?.toString().slice(0, 40) || node.tagName;
			out.push(`${name} top=${Math.round(node.scrollTop)} overflow-y=${overflow}`);
		}
		node = node.parentElement;
	}
	// The document itself scrolling is the classic iOS symptom: a fixed layout
	// gets shoved upward to reveal the caret and leaves blank space behind.
	const doc = win.document.documentElement;
	if (doc.scrollTop || win.scrollY) {
		out.push(`<html> top=${Math.round(doc.scrollTop)} window.scrollY=${Math.round(win.scrollY)}`);
	}
	return out.length ? out.join("; ") : "(none scrolled)";
}

/**
 * Any ancestor carrying a transform, and what it is.
 *
 * A scale or a translate anywhere above the view moves everything inside it,
 * and unlike a scroll it can move it sideways — which is how the fault was
 * described. Nothing here should normally have one.
 */
function transformedAncestors(root: HTMLElement | null, win: Window): string {
	if (!root) return "—";
	const out: string[] = [];
	let node: Element | null = root;
	while (node) {
		const t = win.getComputedStyle(node).transform;
		if (t && t !== "none") {
			const name = node.className?.toString().slice(0, 40) || node.tagName;
			out.push(`${name}: ${t}`);
		}
		node = node.parentElement;
	}
	return out.length ? out.join("; ") : "(none)";
}

/** One reading of everything that could be responsible. */
export function measure(win: Window, root: HTMLElement | null): Record<string, string | number> {
	const doc = win.document;
	const de = doc.documentElement;
	const vv = win.visualViewport;
	const active = doc.activeElement;

	const leaf = root?.closest(".workspace-leaf") ?? null;
	const leafContent = root?.closest(".workspace-leaf-content") ?? null;
	const shell = root?.querySelector(".lv-shell") ?? null;
	const scroll = root?.querySelector(".lv-scroll") ?? null;
	const overlay = root?.querySelector(".lv-overlay") ?? null;
	const add = root?.querySelector(".lv-add") ?? null;

	const values: Record<string, string | number> = {
		"window.inner": `${win.innerWidth}×${win.innerHeight}`,
		"visualViewport": vv
			? `${Math.round(vv.width)}×${Math.round(vv.height)} offset=${Math.round(vv.offsetLeft)},${Math.round(vv.offsetTop)} page=${Math.round(vv.pageLeft)},${Math.round(vv.pageTop)}`
			: "(unsupported)",
		/*
		 * The scale, on its own line because it is the discriminating one.
		 *
		 * The symptom was described as everything moving up *and away to the
		 * sides*. A scroll cannot do that; a zoom can. iOS zooms a WKWebView to a
		 * focused field whose font is under 16px unless the page's viewport meta
		 * forbids it, and that meta belongs to Obsidian, not to a plugin. A scale
		 * above 1 here settles it in one reading.
		 */
		"visualViewport.scale": vv ? vv.scale : "(unsupported)",
		"devicePixelRatio": win.devicePixelRatio,
		"window.scroll": `${Math.round(win.scrollX)},${Math.round(win.scrollY)}`,
		"--zoom-factor": cssVar(de, "--zoom-factor", win),
		// Under 16px is what iOS zooms in order to reach. Recorded beside the
		// scale so the two can be read together rather than guessed at apart.
		"focused font-size":
			active instanceof HTMLElement ? win.getComputedStyle(active).fontSize : "—",
		"transformed ancestors": transformedAncestors(root, win),
		"--keyboard-height": cssVar(de, "--keyboard-height", win),
		"--safe-area-inset-bottom": cssVar(de, "--safe-area-inset-bottom", win),
		"--navbar-height": cssVar(doc.body, "--navbar-height", win),
		"--view-bottom-spacing": cssVar(doc.body, "--view-bottom-spacing", win),
		"body.class": doc.body.className.slice(0, 160) || "(none)",
		".app-container": rect(doc.querySelector(".app-container")),
		".workspace-leaf": rect(leaf),
		".workspace-leaf-content": rect(leafContent),
		".view-content (.lv-root)": rect(root),
		".lv-root client": root ? `${root.clientWidth}×${root.clientHeight}` : "—",
		".lv-root scrollTop": root ? Math.round(root.scrollTop) : "—",
		".lv-shell": rect(shell),
		".lv-scroll": rect(scroll),
		".lv-scroll scrollTop": scroll ? Math.round(scroll.scrollTop) : "—",
		".lv-overlay": rect(overlay),
		".lv-add": rect(add),
		"--lv-keyboard-height": cssVar(root, "--lv-keyboard-height", win),
		"--lv-navbar-clearance": cssVar(root, "--lv-navbar-clearance", win),
		"focused": active
			? `${active.tagName.toLowerCase()}.${(active.className || "").toString().slice(0, 40)}`
			: "(none)",
		"focused rect": rect(active),
		"scrolled ancestors": scrolledAncestors(active, win),
	};
	return values;
}

/**
 * Records samples until told to stop, then writes them up.
 *
 * Samples are taken on every event that could plausibly move the layout *and*
 * on a slow timer, because the interesting moment is often between two events:
 * Obsidian lifts its own height cap while the keyboard animates
 * (`body.is-mobile.keyboard-animating .app-container { max-height: 100vh }`),
 * and a fault that only exists during that window would never land on an event.
 */
export class LayoutRecorder {
	private samples: Sample[] = [];
	private cleanups: (() => void)[] = [];
	private started = 0;
	private timer: number | null = null;

	/** Cap so a recording left running overnight cannot fill a note. */
	private static readonly MAX = 400;

	constructor(
		private app: App,
		private root: () => HTMLElement | null
	) {}

	get recording(): boolean {
		return this.cleanups.length > 0;
	}

	start(): void {
		if (this.recording) return;
		this.samples = [];
		this.started = Date.now();

		const el = this.root();
		const win = el?.win ?? window;

		const take = (event: string) => () => {
			if (this.samples.length >= LayoutRecorder.MAX) return;
			this.samples.push({
				t: Date.now() - this.started,
				event,
				values: measure(win, this.root()),
			});
		};

		const on = (target: EventTarget, type: string, fn: EventListener) => {
			target.addEventListener(type, fn);
			this.cleanups.push(() => target.removeEventListener(type, fn));
		};

		for (const type of [
			"focusin",
			"focusout",
			"keyboardWillShow",
			"keyboardDidShow",
			"keyboardWillHide",
			"keyboardDidHide",
			"resize",
			"orientationchange",
		]) {
			// A tick late, deliberately: Obsidian writes --keyboard-height in
			// response to the same events, and reading first would record the
			// value from before it changed.
			on(win, type, () => win.setTimeout(take(type), 0));
		}
		if (win.visualViewport) {
			on(win.visualViewport, "resize", take("viewport resize"));
			on(win.visualViewport, "scroll", take("viewport scroll"));
		}

		this.timer = win.setInterval(take("tick"), 250);
		this.cleanups.push(() => {
			if (this.timer !== null) win.clearInterval(this.timer);
			this.timer = null;
		});

		take("start")();
		new Notice(
			"List Vibes: recording. Tap the field that misbehaves, then run the command again to save the report.",
			8000
		);
	}

	async stop(): Promise<void> {
		if (!this.recording) return;
		for (const fn of this.cleanups) fn();
		this.cleanups = [];

		const file = await this.write(this.report());
		if (file) {
			new Notice(`List Vibes: saved ${file.path}`, 6000);
			await this.app.workspace.getLeaf(true).openFile(file);
		} else {
			new Notice("List Vibes: could not write the report.", 6000);
		}
	}

	/**
	 * One markdown table per sample, in order.
	 *
	 * Deliberately not deduplicated. A run of identical samples is itself the
	 * finding — it says the layout did not react to the keyboard at all, which
	 * is a different fault from reacting wrongly, and collapsing them would hide
	 * exactly that.
	 */
	private report(): string {
		const lines: string[] = [
			"---",
			"tags: [list-vibes/diagnostic]",
			"---",
			"",
			"# List Vibes — layout report",
			"",
			`Recorded ${new Date(this.started).toISOString()}, ${this.samples.length} samples.`,
			"",
			"Sizes are `left,top width×height` in CSS pixels, relative to the viewport.",
			"No task text, file names or note contents are included.",
			"",
		];

		for (const s of this.samples) {
			lines.push(`## +${s.t}ms — ${s.event}`, "", "| | |", "|---|---|");
			for (const [k, v] of Object.entries(s.values)) {
				// Pipes would break the table; nothing measured here should
				// contain one, but a class name set by a theme could.
				lines.push(`| \`${k}\` | ${String(v).replace(/\|/g, "\\|")} |`);
			}
			lines.push("");
		}
		return lines.join("\n");
	}

	private async write(content: string): Promise<TFile | null> {
		const base = "List Vibes layout report";
		for (let n = 0; n < 50; n++) {
			const path = n === 0 ? `${base}.md` : `${base} ${n + 1}.md`;
			if (this.app.vault.getAbstractFileByPath(path)) continue;
			try {
				return await this.app.vault.create(path, content);
			} catch {
				// Another process got there first, or the name is not usable on
				// this filesystem. Try the next one rather than giving up.
			}
		}
		return null;
	}
}
