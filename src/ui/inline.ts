import { DetailContext } from "../views/context";

/**
 * Render a task title's inline markdown as real elements.
 *
 * Deliberately hand-rolled and small rather than using MarkdownRenderer: titles
 * are single lines, we only care about four constructs, and this avoids
 * rendering a full block context per row for lists with a hundred tasks.
 * No innerHTML anywhere — createEl only, per the plugin guidelines.
 */

type Piece =
	| { t: "text"; v: string }
	| { t: "link"; label: string; href: string }
	| { t: "wiki"; target: string; label: string }
	| { t: "tag"; v: string }
	| { t: "code"; v: string }
	| { t: "bold"; v: string }
	| { t: "italic"; v: string }
	| { t: "strike"; v: string };

/**
 * Is the character before `at` something a token may start after?
 *
 * This used to be a lookbehind in the pattern — `(?<![A-Za-z0-9])` for a bare
 * URL, `(?:^|(?<=\s))` for a tag. Lookbehind is unsupported on iOS before
 * 16.4, where an unsupported group does not degrade: the whole `RegExp`
 * constructor throws, and every task title in the plugin renders as nothing.
 *
 * The same question in JavaScript costs one character comparison and works
 * everywhere. Keeping it out of the pattern also leaves the capture-group
 * numbers alone, which the reader below depends on.
 */
function startsCleanly(text: string, at: number, forbidden: RegExp): boolean {
	return at === 0 || !forbidden.test(text[at - 1]);
}

const PATTERN = new RegExp(
	[
		"`([^`]+)`", // 1 code
		"\\[\\[([^\\]|]+)(?:\\|([^\\]]+))?\\]\\]", // 2 target, 3 label
		"\\[([^\\]]*)\\]\\(([^)\\s]+)\\)", // 4 label, 5 href
		"(https?://[^\\s)]+)", // 6 bare url — boundary checked below, not by lookbehind
		"~~([^~]+)~~", // 7 strike
		"\\*\\*([^*]+)\\*\\*", // 8 bold
		"\\*([^*]+)\\*", // 9 italic
		"(#[^\\s#\\[\\]()]+)", // 10 tag — boundary checked below, not by lookbehind
	].join("|"),
	"gu"
);

export function parseInline(text: string): Piece[] {
	const out: Piece[] = [];
	let last = 0;
	let m: RegExpExecArray | null;
	PATTERN.lastIndex = 0;

	while ((m = PATTERN.exec(text)) !== null) {
		/*
		 * The two boundary rules the lookbehinds used to enforce. A rejected
		 * match is left as text by *not* advancing `last`, so it is swept up by
		 * the next text run rather than dropped — `nothttps://x.dev` keeps its
		 * "not", and `issue#12` keeps its number.
		 */
		if (m[6] !== undefined && !startsCleanly(text, m.index, /[A-Za-z0-9]/)) continue;
		if (m[10] !== undefined && !startsCleanly(text, m.index, /\S/)) continue;

		if (m.index > last) out.push({ t: "text", v: text.slice(last, m.index) });

		if (m[1] !== undefined) out.push({ t: "code", v: m[1] });
		else if (m[2] !== undefined)
			out.push({ t: "wiki", target: m[2], label: m[3] ?? m[2] });
		else if (m[5] !== undefined)
			out.push({ t: "link", label: m[4] || m[5], href: m[5] });
		else if (m[6] !== undefined) out.push({ t: "link", label: m[6], href: m[6] });
		else if (m[7] !== undefined) out.push({ t: "strike", v: m[7] });
		else if (m[8] !== undefined) out.push({ t: "bold", v: m[8] });
		else if (m[9] !== undefined) out.push({ t: "italic", v: m[9] });
		else if (m[10] !== undefined) out.push({ t: "tag", v: m[10] });

		last = m.index + m[0].length;
	}
	if (last < text.length) out.push({ t: "text", v: text.slice(last) });
	return out;
}

export function renderInline(el: HTMLElement, text: string, ctx: DetailContext): void {
	for (const p of parseInline(text)) {
		switch (p.t) {
			case "text":
				el.appendText(p.v);
				break;
			case "code":
				el.createEl("code", { text: p.v });
				break;
			case "bold":
				el.createEl("strong", { text: p.v });
				break;
			case "italic":
				el.createEl("em", { text: p.v });
				break;
			case "strike":
				el.createEl("del", { text: p.v });
				break;
			case "tag":
				el.createSpan({ cls: "lv-tag", text: p.v });
				break;
			case "link": {
				const a = el.createEl("a", {
					cls: "external-link lv-link",
					text: p.label,
					href: p.href,
				});
				a.setAttribute("rel", "noopener noreferrer");
				a.addEventListener("click", (e) => e.stopPropagation());
				break;
			}
			case "wiki": {
				const a = el.createEl("a", { cls: "internal-link lv-link", text: p.label });
				a.addEventListener("click", (e) => {
					e.preventDefault();
					e.stopPropagation();
					void ctx.app.workspace.openLinkText(p.target, "", false);
				});
				break;
			}
		}
	}
}
