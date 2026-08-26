/*
 * Paste this into the Chrome DevTools console attached to Obsidian on the
 * tablet (chrome://inspect -> inspect). Paste it ONCE.
 *
 * It hooks the keyboard and, on every change, writes a full box-and-style dump
 * of the whole ancestor chain to "List Vibes live dump.md" in the vault. The
 * vault syncs to the Mac, so the dump arrives without anybody transcribing a
 * screenshot.
 *
 * Chrome may refuse the first paste into a console with a warning about
 * self-XSS. Type   allow pasting   and press Enter, then paste this.
 *
 * To stop it:  __lvStop()
 */
(() => {
	const d = document, w = window;
	const FILE = "List Vibes live dump.md";
	const KEYS = [
		"position", "display", "height", "maxHeight", "minHeight", "flex",
		"overflowY", "contain", "transform", "zIndex", "paddingBottom",
		"marginBottom", "visibility", "opacity", "inset", "top", "bottom",
	];

	const snap = (el) => {
		const r = el.getBoundingClientRect(), c = getComputedStyle(el);
		const out = {
			el: (el.tagName.toLowerCase() + "." + String(el.className || "")).slice(0, 70),
			top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height),
		};
		for (const k of KEYS) {
			const v = c[k];
			// Only what is not the browser default, so the dump is readable.
			if (v && v !== "auto" && v !== "none" && v !== "visible" && v !== "static" && v !== "0px" && v !== "1" && v !== "normal") {
				out[k] = String(v).slice(0, 40);
			}
		}
		return out;
	};

	const measure = () => {
		const probe = d.createElement("div");
		probe.style.cssText = "position:fixed;top:0;left:0;width:1px;height:100vh;visibility:hidden";
		d.body.appendChild(probe);
		const vh = Math.round(probe.getBoundingClientRect().height);
		probe.style.height = "100dvh";
		const dvh = Math.round(probe.getBoundingClientRect().height);
		probe.remove();

		const vv = w.visualViewport;
		// From the focused field if there is one, otherwise from our view, all
		// the way out to <html>. This is the chain that has to add up.
		const start = (d.activeElement && d.activeElement !== d.body)
			? d.activeElement
			: d.querySelector(".lv-root");
		const chain = [];
		for (let n = start; n; n = n.parentElement) chain.push(snap(n));

		// And the app shell's own children, which is where Obsidian's chrome and
		// the drawer live — the boxes a plugin can see but not control.
		const app = d.querySelector(".app-container");
		const shell = app ? [snap(app), ...[...app.children].map(snap)] : [];
		const drawer = d.querySelector(".workspace-drawer");
		const drawerBoxes = drawer ? [snap(drawer), ...[...drawer.querySelectorAll("*")].slice(0, 12).map(snap)] : [];

		return {
			inner: w.innerHeight, client: d.documentElement.clientHeight, vh, dvh,
			visual: vv ? Math.round(vv.height) : null,
			visualTop: vv ? Math.round(vv.offsetTop) : null,
			scale: vv ? vv.scale : null,
			gap: vv ? Math.round(w.innerHeight - vv.height) : null,
			keyboardVar: getComputedStyle(d.documentElement).getPropertyValue("--keyboard-height").trim(),
			screen: `${w.screen.width}x${w.screen.height} dpr=${w.devicePixelRatio}`,
			orientation: w.innerWidth > w.innerHeight ? "landscape" : "portrait",
			body: d.body.className,
			focus: d.activeElement ? d.activeElement.tagName.toLowerCase() + "." + String(d.activeElement.className || "") : "none",
			chain, shell, drawer: drawerBoxes,
		};
	};

	const frames = [];
	let last = "";
	const tick = () => {
		const m = measure();
		// One frame per change of shape. The panel ticks several times a second
		// and a file of identical frames buries the two that matter.
		const shape = [m.inner, m.visual, m.keyboardVar, m.chain[m.chain.length - 1]?.h, m.shell[0]?.h].join("/");
		if (shape === last) return;
		last = shape;
		frames.push(m);
		if (frames.length > 24) frames.splice(0, 12);
		const body = [
			"# List Vibes — live dump",
			"",
			"Captured from the DevTools console. Newest frame last.",
			"",
			"```json",
			JSON.stringify(frames, null, 1),
			"```",
			"",
		].join("\n");
		app.vault.adapter.write(FILE, body).catch((e) => console.error("dump write failed", e));
	};

	const timer = setInterval(tick, 200);
	w.__lvStop = () => { clearInterval(timer); console.log("live dump stopped"); };
	tick();
	console.log(`live dump armed -> "${FILE}" in the vault. __lvStop() to stop.`);
})();
