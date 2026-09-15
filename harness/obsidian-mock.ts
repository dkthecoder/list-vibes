/**
 * Minimal stand-in for the `obsidian` module, enough to render the real pane
 * code in a plain browser so the UI can be inspected and screenshotted without
 * an Obsidian install. Only used by the harness build; never shipped.
 */

/* ---- Obsidian's DOM helpers, which it patches onto Element ---- */

interface ElInfo {
	cls?: string;
	text?: string;
	attr?: Record<string, string>;
	type?: string;
	href?: string;
}

function applyInfo(el: HTMLElement, info?: ElInfo | string) {
	if (!info) return el;
	if (typeof info === "string") {
		el.className = info;
		return el;
	}
	if (info.cls) el.className = info.cls;
	if (info.text !== undefined) el.textContent = info.text;
	if (info.type) el.setAttribute("type", info.type);
	if (info.href) el.setAttribute("href", info.href);
	if (info.attr) for (const [k, v] of Object.entries(info.attr)) el.setAttribute(k, v);
	return el;
}

export function installDomHelpers(): void {
	const p = HTMLElement.prototype as unknown as Record<string, unknown>;

	// Obsidian's cross-window-safe type check. One window here, so the plain
	// operator is the same answer — but the source uses the API, and a DOM
	// augmentation missing from the browser is how three bugs have got through.
	(Node.prototype as unknown as Record<string, unknown>).instanceOf = function (
		this: Node,
		cls: unknown
	) {
		return this instanceof (cls as new () => unknown);
	};

	p.createEl = function (tag: string, info?: ElInfo) {
		const el = document.createElement(tag);
		applyInfo(el, info);
		(this as HTMLElement).appendChild(el);
		return el;
	};
	p.createDiv = function (info?: ElInfo | string) {
		return (this as never as { createEl: (t: string, i?: ElInfo | string) => HTMLElement }).createEl("div", info as ElInfo);
	};
	p.createSpan = function (info?: ElInfo | string) {
		return (this as never as { createEl: (t: string, i?: ElInfo | string) => HTMLElement }).createEl("span", info as ElInfo);
	};
	p.empty = function () {
		(this as HTMLElement).textContent = "";
	};
	p.setText = function (t: string) {
		(this as HTMLElement).textContent = t;
	};
	p.appendText = function (t: string) {
		(this as HTMLElement).appendChild(document.createTextNode(t));
	};
	/*
	 * Obsidian's own way of setting CSS custom properties from code. Real in the
	 * app, absent in a browser — the same trap `el.win` sprang twice, so it is
	 * mocked here rather than avoided in the source.
	 */
	p.setCssProps = function (props: Record<string, string>) {
		const el = this as unknown as HTMLElement;
		for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v);
	};

	p.addClass = function (...c: string[]) {
		(this as HTMLElement).classList.add(...c);
	};
	p.removeClass = function (...c: string[]) {
		(this as HTMLElement).classList.remove(...c);
	};
	p.toggleClass = function (c: string, on: boolean) {
		(this as HTMLElement).classList.toggle(c, on);
	};
	p.findAll = function (sel: string) {
		return Array.from((this as HTMLElement).querySelectorAll(sel));
	};
}

/* ---- Icons: small inline SVGs standing in for lucide ---- */

const PATHS: Record<string, string> = {
	circle: '<circle cx="12" cy="12" r="9"/>',
	"check-circle-2": '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
	star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z"/>',
	sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
	calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
	"calendar-days": '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
	bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
	repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
	plus: '<path d="M12 5v14M5 12h14"/>',
	x: '<path d="M18 6 6 18M6 6l12 12"/>',
	"trash-2": '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
	list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
	"list-todo": '<path d="M3 5h.01M3 12h.01M3 19h.01M8 5h13M8 12h13M8 19h13"/>',
	"chevron-right": '<path d="m9 6 6 6-6 6"/>',
	"chevron-down": '<path d="m6 9 6 6 6-6"/>',
	"chevron-left": '<path d="m15 6-6 6 6 6"/>',
	"more-horizontal": '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
	"check-check": '<path d="m2 12 5 5L17 7"/><path d="m13 17 4 0"/>',
	"square-check-big": '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>',
	"file-text": '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
	pencil: '<path d="M4 20h4L20 8l-4-4L4 16z"/>',
	clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
	"arrow-up-down": '<path d="m7 15 5 5 5-5"/><path d="M12 4v16"/><path d="m7 9 5-5 5 5"/>',
	"arrow-down-narrow-wide": '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M11 4h4"/><path d="M11 8h7"/><path d="M11 12h10"/>',
	"arrow-up-narrow-wide": '<path d="m3 8 4-4 4 4"/><path d="M7 4v16"/><path d="M11 12h4"/><path d="M11 16h7"/><path d="M11 20h10"/>',
	"arrow-down-a-z": '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M15 4h5l-5 6h5"/><path d="M15 20v-4a2 2 0 1 1 4 0v4"/>',
	"chevron-up": '<path d="m18 15-6-6-6 6"/>',
	"layout-grid": '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
	palette: '<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2a10 10 0 1 0 0 20 2 2 0 0 0 2-2v-1a2 2 0 0 1 2-2h1a4 4 0 0 0 4-4 10 10 0 0 0-9-11z"/>',
	ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
	check: '<path d="M4 12l5 5L20 6"/>',
	"arrow-up-a-z": '<path d="m3 8 4-4 4 4"/><path d="M7 4v16"/><path d="M15 4h5l-5 6h5"/><path d="M15 20v-4a2 2 0 1 1 4 0v4"/>',
};

export function setIcon(el: HTMLElement, name: string): void {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("fill", "none");
	svg.setAttribute("stroke", "currentColor");
	svg.setAttribute("stroke-width", "2");
	svg.setAttribute("stroke-linecap", "round");
	svg.setAttribute("stroke-linejoin", "round");
	svg.setAttribute("class", "svg-icon");
	// Harness only: the shipped plugin never assembles markup as a string.
	svg.innerHTML = PATHS[name] ?? PATHS.circle;
	el.appendChild(svg);
}

/* ---- API surface the pane code touches ---- */

export function normalizePath(p: string): string {
	return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

export class Notice {
	constructor(public message: string) {
		console.log("[Notice]", message);
	}
}

export class Menu {
	addItem(): this {
		return this;
	}
	addSeparator(): this {
		return this;
	}
	showAtMouseEvent(): void {
		/* no-op in the harness */
	}
}

export class TFile {
	constructor(
		public path = "",
		public extension = "md"
	) {}
}
export class TFolder {
	children: unknown[] = [];
}
export class TAbstractFile {}
export class Modal {
	app: unknown;
	contentEl = document.createElement("div");
	titleEl = document.createElement("div");
	constructor(app: unknown) {
		this.app = app;
	}
	open(): void {}
	close(): void {}
}
export class Setting {
	infoEl = document.createElement("div");
	constructor(public el: HTMLElement) {}
	setName(): this {
		return this;
	}
	setDesc(): this {
		return this;
	}
	setHeading(): this {
		return this;
	}
	addText(): this {
		return this;
	}
	addButton(): this {
		return this;
	}
	addToggle(): this {
		return this;
	}
	addDropdown(): this {
		return this;
	}
}
export class PluginSettingTab {}
export class Plugin {}
export class ItemView {}
export class WorkspaceLeaf {}
export const Platform = { isMobile: false, isPhone: false, isTablet: false };
