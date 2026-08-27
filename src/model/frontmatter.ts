/**
 * Surgical frontmatter edits.
 *
 * Obsidian offers `fileManager.processFrontMatter`, which round-trips the block
 * through a YAML parser. That is convenient but it can reorder keys and
 * normalise formatting — and these files belong to the user, not to us. One of
 * them is a Kanban board whose plugin reads its own frontmatter. So this edits
 * the single line it is asked to and leaves every other byte alone, which is the
 * same rule the task-line editing follows.
 *
 * Pure, so it is unit-testable without Obsidian.
 */

const FENCE = /^---\s*$/;

export interface FrontmatterBlock {
	/** Line index of the opening `---`, or -1 when there is no block. */
	start: number;
	/** Line index of the closing `---`. */
	end: number;
}

/**
 * Locate the frontmatter block. It only counts when the file opens with it —
 * a `---` further down is a horizontal rule, not frontmatter.
 */
export function findFrontmatter(lines: string[]): FrontmatterBlock | null {
	if (!lines.length || !FENCE.test(lines[0])) return null;
	for (let i = 1; i < lines.length; i++) {
		if (FENCE.test(lines[i])) return { start: 0, end: i };
	}
	// An unterminated opening fence is not a block; treat it as content.
	return null;
}

/** Index of a top-level `key:` line within the block, or -1. */
function findKeyLine(lines: string[], block: FrontmatterBlock, key: string): number {
	const re = new RegExp(`^${escapeRe(key)}\\s*:`);
	for (let i = block.start + 1; i < block.end; i++) {
		// Only top-level keys: an indented line belongs to a nested structure.
		if (/^\s/.test(lines[i])) continue;
		if (re.test(lines[i])) return i;
	}
	return -1;
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Quote a scalar only when YAML would otherwise misread it. Emoji, plain words
 * and hex colours are all fine bare; leading indicators and anything with a
 * colon-space are not.
 */
export function formatScalar(value: string): string {
	if (value === "") return '""';
	if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)) return JSON.stringify(value);
	if (/:\s/.test(value) || /\s#/.test(value)) return JSON.stringify(value);
	if (/^\s|\s$/.test(value)) return JSON.stringify(value);
	// Bare words YAML would read as booleans or null.
	if (/^(true|false|yes|no|on|off|null|~)$/i.test(value)) return JSON.stringify(value);
	if (/^[+-]?(\d|\.\d)/.test(value) && /^[+-]?[\d._eE+-]*$/.test(value)) {
		return JSON.stringify(value);
	}
	return value;
}

/**
 * Set, replace or remove one top-level frontmatter key.
 *
 * Passing null removes the key. Removing the last key leaves an empty block
 * rather than deleting the fences, because an empty block is still valid and
 * removing it would change more of the file than asked.
 *
 * Returns the new content, or the original string unchanged if nothing needed
 * doing — so callers can skip the write.
 */
export function setFrontmatterKey(
	content: string,
	key: string,
	value: string | null
): string {
	const eol = content.includes("\r\n") ? "\r\n" : "\n";
	const lines = content.split(/\r?\n/);
	const block = findFrontmatter(lines);

	// --- no block yet ---
	if (!block) {
		if (value === null) return content;
		const header = ["---", `${key}: ${formatScalar(value)}`, "---"];
		// Keep exactly one blank line between the block and the body.
		const body = lines[0] === "" ? lines.slice(1) : lines;
		return [...header, "", ...body].join(eol);
	}

	const at = findKeyLine(lines, block, key);

	// --- remove ---
	if (value === null) {
		if (at < 0) return content;
		lines.splice(at, 1);
		return lines.join(eol);
	}

	const line = `${key}: ${formatScalar(value)}`;

	// --- replace in place ---
	if (at >= 0) {
		if (lines[at] === line) return content;
		lines[at] = line;
		return lines.join(eol);
	}

	// --- append inside the block, just before the closing fence ---
	lines.splice(block.end, 0, line);
	return lines.join(eol);
}

/** Read one top-level key back, for tests and for round-trip checks. */
export function getFrontmatterKey(content: string, key: string): string | null {
	const lines = content.split(/\r?\n/);
	const block = findFrontmatter(lines);
	if (!block) return null;
	const at = findKeyLine(lines, block, key);
	if (at < 0) return null;
	const raw = lines[at].slice(lines[at].indexOf(":") + 1).trim();
	if (raw.startsWith('"') || raw.startsWith("'")) {
		try {
			// A quoted scalar, so the parse yields a string or nothing useful.
			return JSON.parse(raw.replace(/^'|'$/g, '"')) as string;
		} catch {
			return raw.replace(/^['"]|['"]$/g, "");
		}
	}
	return raw;
}
