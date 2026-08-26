/**
 * The one line of a task's note that shows under its title.
 *
 * A note is free markdown indented under the task line, so it can be several
 * paragraphs, a bullet list, or a quote. The row has room for exactly one line,
 * and CSS does the cutting off — so the job here is to turn whatever is in the
 * file into a single line worth cutting off, rather than to decide where it gets
 * cut.
 *
 * Everything is collapsed onto that one line rather than only the first line
 * being taken. A note wrapped across three lines in the file is still one
 * sentence, and showing "I said I would" when the note reads "I said I would
 * call them back on Tuesday" is worse than showing the whole sentence and
 * letting the ellipsis land where it lands.
 */

/**
 * Markers that carry no meaning once the note is one line: list bullets,
 * blockquote arrows, heading hashes, and task checkboxes at the start of a line.
 * Stripped per line, before the lines are joined, so a bulleted note reads as a
 * sentence rather than as "- milk - eggs - bread".
 */
const LEADING = /^\s*(?:[-*+]\s+\[[^\]]?\]\s*|[-*+]\s+|\d+[.)]\s+|>+\s*|#{1,6}\s+)/;

export function notePreview(note: string | undefined | null): string {
	if (!note) return "";

	const parts: string[] = [];
	for (const line of note.split(/\r?\n/)) {
		const cleaned = line.replace(LEADING, "").trim();
		if (cleaned) parts.push(cleaned);
	}

	// One space between what were separate lines, and no runs of whitespace
	// anywhere — a tab in the file must not become a gap in the row.
	return parts.join(" ").replace(/\s+/g, " ").trim();
}
