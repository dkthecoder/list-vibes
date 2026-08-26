/**
 * Reading the rules that are actually in force, on the device they are in force
 * on.
 *
 * Every round of this fault so far has been an argument about a stylesheet
 * nobody in the argument has read. Obsidian's `app.css` is bundled inside the
 * app, so it cannot be opened from a desktop, let alone from a tablet — and the
 * rule everything has been reasoned from, `body.is-mobile .app-container
 * { max-height: calc(100vh - var(--keyboard-height)) }`, is quoted from memory
 * and community write-ups rather than from the file.
 *
 * It does not have to be. The stylesheet is loaded in the same document the
 * plugin runs in, `document.styleSheets` enumerates it, and same-origin rules
 * can be read straight off it. So the plugin can answer the question on the
 * device: what rules mention the keyboard, what do they say, and do they match
 * the element everyone assumes they match.
 *
 * Written to a note in the vault rather than drawn on screen, because a vault
 * syncs and a screenshot has to be transcribed.
 */

/** The parts of a CSSStyleSheet this needs, so it can be tested without a DOM. */
export interface ReadableSheet {
	href?: string | null;
	/** Throws for a cross-origin sheet, which is the case that must not crash. */
	readonly cssRules?: ArrayLike<{ cssText?: string; selectorText?: string }>;
}

export interface FoundRule {
	sheet: string;
	selector: string;
	text: string;
}

/**
 * Every rule in the document whose text mentions `needle`.
 *
 * A cross-origin sheet throws on `cssRules` rather than returning nothing —
 * a `SecurityError` from one sheet must not lose the rules from all the others,
 * so each is guarded on its own.
 */
export function rulesMentioning(
	sheets: Iterable<ReadableSheet>,
	needle: string,
	limit = 40
): FoundRule[] {
	const found: FoundRule[] = [];
	let index = 0;
	for (const sheet of sheets) {
		index++;
		const name = sheet.href ? String(sheet.href).split("/").pop() : `sheet ${index}`;
		let rules: ArrayLike<{ cssText?: string; selectorText?: string }> | undefined;
		try {
			rules = sheet.cssRules;
		} catch {
			// Cross-origin. Nothing to read, and nothing to report but the fact.
			found.push({ sheet: name ?? "?", selector: "(unreadable)", text: "" });
			continue;
		}
		if (!rules) continue;
		for (let i = 0; i < rules.length && found.length < limit; i++) {
			const text = rules[i]?.cssText ?? "";
			if (!text.includes(needle)) continue;
			found.push({
				sheet: name ?? "?",
				selector: rules[i]?.selectorText ?? "",
				text,
			});
		}
		if (found.length >= limit) break;
	}
	return found;
}

/** One moment in time, in the numbers that tell the explanations apart. */
export interface Sample {
	at: string;
	innerHeight: number;
	clientHeight: number;
	vh: number;
	dvh: number;
	visual: number;
	offsetTop: number;
	scale: number;
	keyboardVar: number;
	appHeight: number;
	appMaxHeight: string;
	shortened: string[];
	bodyClass: string;
}

/**
 * The gap between the layout viewport and the visual one.
 *
 * This is the number the whole diagnosis turns on. If the window itself was
 * resized for the keyboard then both shrink together and the gap stays where it
 * was; if only the visual viewport was resized then the gap grows by a
 * keyboard. Both happening at once is the double count.
 */
export function viewportGap(s: Pick<Sample, "innerHeight" | "visual">): number {
	return Math.round(s.innerHeight - s.visual);
}

/**
 * Which mechanism a pair of samples describes — one at rest, one with the
 * keyboard up.
 *
 * Deliberately returns a sentence rather than an enum. It is read by a person
 * in a note, and the reasoning is the useful part.
 */
export function explain(rest: Sample, typing: Sample): string {
	const shrank = rest.innerHeight - typing.innerHeight;
	const gapGrew = viewportGap(typing) - viewportGap(rest);
	const enough = (n: number) => n >= 60;

	if (enough(shrank) && enough(gapGrew)) {
		return `The window shrank by ${shrank}px AND the visual viewport lost a further ${gapGrew}px. That is the keyboard counted twice, and both counts are native — no stylesheet is involved.`;
	}
	if (enough(shrank)) {
		return `The window shrank by ${shrank}px and the visual viewport kept pace with it (gap moved ${gapGrew}px). The keyboard is already accounted for, so anything that subtracts it again — a rule, or this plugin — is what is wrong.`;
	}
	if (enough(gapGrew)) {
		return `The window kept its height and the visual viewport lost ${gapGrew}px. This is the ordinary case the platform rule is written for: the keyboard overlays, and subtracting it once is correct.`;
	}
	return `Neither the window nor the visual viewport moved (window ${shrank}px, gap ${gapGrew}px). Whatever is shortening the app, it is not being reported to the page at all.`;
}

/** The report itself: rules first, because they are what nobody has read. */
export function formatReport(
	rules: FoundRule[],
	matching: string[],
	samples: Sample[]
): string {
	const rest = samples.find((s) => s.keyboardVar === 0) ?? samples[0];
	const typing = [...samples]
		.reverse()
		.find((s) => s.innerHeight < (rest?.innerHeight ?? 0) || s.keyboardVar > 0);

	const lines: string[] = [
		"# List Vibes — keyboard report",
		"",
		"Written by the plugin on the device. Temporary; delete when the mobile",
		"keyboard fault is closed.",
		"",
		"## Verdict",
		"",
		rest && typing
			? explain(rest, typing)
			: "Not enough samples yet — one at rest and one with the keyboard up are needed. Turn the readout on, tap a text field, let the keyboard settle, then dismiss it.",
		"",
		"## Rules mentioning `keyboard-height`",
		"",
		rules.length
			? rules.map((r) => "- `" + r.sheet + "` — " + r.text).join("\n")
			: "**None.** No stylesheet in this document mentions `keyboard-height`, so nothing is subtracting a keyboard in CSS and every override written against one has been aimed at a rule that does not exist.",
		"",
		"## Rules that match `.app-container`",
		"",
		matching.length ? matching.map((m) => "- `" + m + "`").join("\n") : "None.",
		"",
		"## Samples",
		"",
		"| at | inner | client | 100vh | 100dvh | visual | gap | top | scale | --keyboard-height | app h | app max-height | shortened ancestors | body |",
		"|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
		...samples.map((s) =>
			[
				s.at,
				s.innerHeight,
				s.clientHeight,
				s.vh,
				s.dvh,
				s.visual,
				viewportGap(s),
				s.offsetTop,
				s.scale,
				s.keyboardVar,
				s.appHeight,
				s.appMaxHeight,
				s.shortened.length ? s.shortened.join(" ") : "none",
				s.bodyClass,
			]
				.map((c) => String(c).replace(/\|/g, "/"))
				.join(" | ")
				.replace(/^/, "| ")
				.replace(/$/, " |")
		),
		"",
		"### How to read it",
		"",
		"- `inner` drops, `gap` flat → the window resized. Nothing left to subtract.",
		"- `inner` holds, `gap` grows → only the visual viewport resized. Subtract once.",
		"- both → the keyboard counted twice, natively, with no CSS in it.",
		"- `shortened ancestors` empty while the app looks squashed → nothing is capped, and the CSS explanation is wrong.",
		"",
	];
	return lines.join("\n");
}
