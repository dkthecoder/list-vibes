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

const PATTERN = new RegExp(
	[
		"`([^`]+)`", // 1 code
		"\\[\\[([^\\]|]+)(?:\\|([^\\]]+))?\\]\\]", // 2 target, 3 label
		"\\[([^\\]]*)\\]\\(([^)\\s]+)\\)", // 4 label, 5 href
		"(?<![A-Za-z0-9])(https?://[^\\s)]+)", // 6 bare url
		"~~([^~]+)~~", // 7 strike
		"\\*\\*([^*]+)\\*\\*", // 8 bold
		"\\*([^*]+)\\*", // 9 italic
		"(?:^|(?<=\\s))(#[^\\s#\\[\\]()]+)", // 10 tag
	].join("|"),
	"gu"
);

export function parseInline(text: string): Piece[] {
	const out: Piece[] = [];
	let last = 0;
	let m: RegExpExecArray | null;
	PATTERN.lastIndex = 0;

	while ((m = PATTERN.exec(text)) !== null) {
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
