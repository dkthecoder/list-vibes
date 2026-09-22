import { App, MarkdownView, Notice, TFile } from "obsidian";
import { HEADING_RE, escapeNoteLine, parseLine } from "./parse";
import { setFrontmatterKey } from "./frontmatter";
import { nextOccurrence } from "./recurrence";
import { stampNow } from "./datetime";
import {
	newTaskLine,
	setField,
	setFields,
	setStatus,
	setTitle,
	today,
} from "./serialize";
import { Dialect, MetaField, Task, TaskMeta, TaskStatus, blockRange } from "./types";

/**
 * All writes go through here.
 *
 * Two rules, both of which are documented review failures if you get them wrong:
 *
 *  1. If the file is open in an editor, use the Editor API. `Vault.process`
 *     writes to disk and the editor then reconciles from the file watcher,
 *     which loses cursor position, selection and folded state.
 *  2. Otherwise use `Vault.process`, which is the atomic read-modify-write.
 *
 * And one rule of our own: never rebuild a whole file from parsed tasks. Every
 * operation replaces or inserts specific lines and leaves the rest byte-identical.
 */
/** How many steps back the plugin remembers. */
const UNDO_LIMIT = 50;

/**
 * One write, as the contents either side of it.
 *
 * `null` on either side is the file not existing — which is how creating and
 * deleting a list fit the same shape as editing one.
 */
interface UndoEntry {
	path: string;
	before: string | null;
	after: string | null;
	/** Still being extended by the action that started it. */
	open: boolean;
}

export class Mutator {
	private app: App;
	private dialect: () => Dialect;
	private addDoneDate: () => boolean;
	private addCreatedDate: () => boolean;
	private stampTime: () => boolean;
	private autoRemoveEmptySections: () => boolean;

	/*
	 * What the last few writes replaced.
	 *
	 * Obsidian's undo is the editor's: CodeMirror history, attached to a
	 * Markdown tab. This view is not one, and the ordinary case — ticking a task
	 * while the file is open nowhere — writes to disk with nothing tracking it.
	 *
	 * Whole file contents rather than inverse operations. Every write already
	 * funnels through the helpers below, so snapshotting there covers every
	 * operation at once, including ones added later, without a single mutation
	 * method knowing undo exists. A list is a few kilobytes; fifty of them is a
	 * price worth paying for not having to write, and maintain, an inverse for
	 * each of twenty operations.
	 */
	private undoStack: UndoEntry[] = [];
	/** Writes made while undoing are the undo, and are not themselves undoable. */
	private undoing = false;
	/** Open groups, so one action that writes twice is still one step back. */
	private groupDepth = 0;

	constructor(
		app: App,
		opts: {
			dialect: () => Dialect;
			addDoneDate: () => boolean;
			addCreatedDate: () => boolean;
			stampTime: () => boolean;
			/** Tidy away a heading the last task just left. Off unless given. */
			autoRemoveEmptySections?: () => boolean;
		}
	) {
		this.app = app;
		this.dialect = opts.dialect;
		this.addDoneDate = opts.addDoneDate;
		this.addCreatedDate = opts.addCreatedDate;
		this.stampTime = opts.stampTime;
		this.autoRemoveEmptySections = opts.autoRemoveEmptySections ?? (() => false);
	}

	/**
	 * The moment a task was finished or started, as it goes into the file.
	 *
	 * Behind a setting because it changes what is written into the user's own
	 * markdown. `✅ 2026-08-26` is what the Tasks plugin expects and what every
	 * existing line in the vault already says; `✅ 2026-08-26T14:32` is more
	 * useful and is ours. Reading copes with both either way, so turning this
	 * off stops new stamps carrying a time and leaves the old ones alone.
	 */
	private stamp(): string {
		return stampNow(this.stampTime());
	}

	private fileFor(path: string): TFile | null {
		const f = this.app.vault.getAbstractFileByPath(path);
		return f instanceof TFile ? f : null;
	}

	/** An open, visible editor showing this file, if there is one. */
	private editorFor(path: string) {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view as MarkdownView;
			if (view.file?.path === path) return view.editor;
		}
		return null;
	}

	/**
	 * Replace a single line. `expect` is the line we believe is there; if it has
	 * changed underneath us the edit is abandoned rather than applied blindly,
	 * because the parse may have been stale.
	 */
	/* ---------------- undo ---------------- */

	/** The file as it stands, or null if it is not there. */
	private async currentText(path: string): Promise<string | null> {
		const editor = this.editorFor(path);
		if (editor) return editor.getValue();
		const file = this.fileFor(path);
		if (!file) return null;
		return await this.app.vault.read(file);
	}

	/**
	 * Record one write, or extend the one this action already started.
	 *
	 * Extending is what keeps a single action a single step back. Completing a
	 * repeating task writes twice — the line is ticked, then the next occurrence
	 * is inserted above it — and two presses of undo to reverse one tick is not
	 * undo, it is arithmetic.
	 */
	private note(path: string, before: string | null, after: string | null): void {
		if (this.undoing) return;
		if (before === after) return;

		const top = this.undoStack[this.undoStack.length - 1];
		if (this.groupDepth > 0 && top?.open && top.path === path) {
			top.after = after;
			return;
		}

		this.undoStack.push({ path, before, after, open: this.groupDepth > 0 });
		if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
	}

	/** Run several writes as one step back. */
	private async group<T>(fn: () => Promise<T>): Promise<T> {
		this.groupDepth++;
		try {
			return await fn();
		} finally {
			this.groupDepth--;
			if (this.groupDepth === 0) {
				const top = this.undoStack[this.undoStack.length - 1];
				if (top) top.open = false;
			}
		}
	}

	/** Snapshot around a write, so the undo stack learns about it. */
	private async recorded(path: string, write: () => Promise<boolean>): Promise<boolean> {
		if (this.undoing) return await write();
		const before = await this.currentText(path);
		const ok = await write();
		if (ok) this.note(path, before, await this.currentText(path));
		return ok;
	}

	canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	/**
	 * Put the last write back.
	 *
	 * Only if the file still says what that write left behind. It may have been
	 * edited by hand, by a sync, or by another plugin since — and restoring what
	 * was there *before* would throw away whatever arrived after. The entry is
	 * dropped either way: an undo that cannot be applied is not one to keep
	 * offering.
	 */
	async undo(): Promise<{ ok: boolean; reason?: string }> {
		const entry = this.undoStack.pop();
		if (!entry) return { ok: false, reason: "nothing to undo" };

		const now = await this.currentText(entry.path);
		if (now !== entry.after) {
			return { ok: false, reason: "the file changed since that edit" };
		}

		this.undoing = true;
		try {
			if (entry.before === null) {
				const file = this.fileFor(entry.path);
				if (file) await this.app.fileManager.trashFile(file);
				return { ok: true };
			}
			if (now === null) {
				// Put a deleted file back. The trashed copy stays where the vault
				// sent it; this is a new file with the old contents, which is the
				// most an API without an un-delete can honestly offer.
				await this.app.vault.create(entry.path, entry.before);
				return { ok: true };
			}
			await this.applyLines(entry.path, () => (entry.before as string).split("\n"));
			return { ok: true };
		} finally {
			this.undoing = false;
		}
	}

	private async replaceLine(
		path: string,
		line: number,
		expect: string,
		next: string
	): Promise<boolean> {
		return this.recorded(path, async () => {
			if (expect === next) return true;

			const editor = this.editorFor(path);
			if (editor) {
				if (line >= editor.lineCount()) return false;
				if (editor.getLine(line) !== expect) return false;
				editor.setLine(line, next);
				return true;
			}

			const file = this.fileFor(path);
			if (!file) return false;

			let ok = false;
			await this.app.vault.process(file, (data) => {
				const lines = data.split("\n");
				if (line >= lines.length || lines[line] !== expect) return data;
				lines[line] = next;
				ok = true;
				return lines.join("\n");
			});
			return ok;
		});
	}

	/** Insert lines at a position, pushing the rest down. */
	private async insertLines(
		path: string,
		at: number,
		text: string[]
	): Promise<boolean> {
		return this.recorded(path, async () => {
			const editor = this.editorFor(path);
			if (editor) {
				const clamped = Math.min(at, editor.lineCount());
				const prefix = clamped >= editor.lineCount() ? "\n" : "";
				editor.replaceRange(
					prefix + text.join("\n") + (prefix ? "" : "\n"),
					{ line: clamped, ch: 0 }
				);
				return true;
			}

			const file = this.fileFor(path);
			if (!file) return false;
			await this.app.vault.process(file, (data) => {
				const lines = data.split("\n");
				const clamped = Math.min(at, lines.length);
				lines.splice(clamped, 0, ...text);
				return lines.join("\n");
			});
			return true;
		});
	}

	/** Remove a range of lines. */
	private async removeLines(path: string, from: number, count: number): Promise<boolean> {
		return this.recorded(path, async () => {
			const editor = this.editorFor(path);
			if (editor) {
				const to = Math.min(from + count, editor.lineCount());
				editor.replaceRange(
					"",
					{ line: from, ch: 0 },
					to >= editor.lineCount()
						? { line: editor.lastLine(), ch: editor.getLine(editor.lastLine()).length }
						: { line: to, ch: 0 }
				);
				return true;
			}
			const file = this.fileFor(path);
			if (!file) return false;
			await this.app.vault.process(file, (data) => {
				const lines = data.split("\n");
				lines.splice(from, count);
				return lines.join("\n");
			});
			return true;
		});
	}


	/**
	 * Rewrite the whole line array, through whichever path the file requires.
	 *
	 * `fn` returns the new lines, or null to abandon the edit — which is how
	 * every caller refuses to write against a file that has shifted underneath
	 * it. The two paths are not interchangeable: Vault.process on a file that is
	 * open writes to disk and lets the editor reconcile from the file watcher
	 * afterwards, which loses the cursor, the selection and every fold.
	 */
	private async applyLines(
		path: string,
		fn: (lines: string[]) => string[] | null
	): Promise<boolean> {
		return this.recorded(path, async () => {
			const editor = this.editorFor(path);
			if (editor) {
				const lines: string[] = [];
				for (let i = 0; i < editor.lineCount(); i++) lines.push(editor.getLine(i));
				const next = fn(lines);
				if (!next) return false;
				editor.transaction({
					changes: [
						{
							from: { line: 0, ch: 0 },
							to: {
								line: editor.lastLine(),
								ch: editor.getLine(editor.lastLine()).length,
							},
							text: next.join("\n"),
						},
					],
				});
				return true;
			}

			const file = this.fileFor(path);
			if (!file) return false;
			let wrote = false;
			await this.app.vault.process(file, (data) => {
				const next = fn(data.split("\n"));
				if (!next) return data;
				wrote = true;
				return next.join("\n");
			});
			return wrote;
		});
	}

	/**
	 * Atomically rewrite a contiguous run of lines. `expect` guards the anchor
	 * line: if it no longer matches, the edit is abandoned rather than applied
	 * somewhere it does not belong.
	 */
	private async spliceLines(
		path: string,
		anchor: number,
		expect: string,
		from: number,
		count: number,
		insert: string[]
	): Promise<boolean> {
		return this.recorded(path, async () => {
			const apply = (lines: string[]): string[] | null => {
				if (anchor >= lines.length || lines[anchor] !== expect) return null;
				const next = [...lines];
				next.splice(from, count, ...insert);
				return next;
			};

			const editor = this.editorFor(path);
			if (editor) {
				const lines: string[] = [];
				for (let i = 0; i < editor.lineCount(); i++) lines.push(editor.getLine(i));
				const next = apply(lines);
				if (!next) return false;
				editor.transaction({
					changes: [
						{
							from: { line: 0, ch: 0 },
							to: { line: editor.lastLine(), ch: editor.getLine(editor.lastLine()).length },
							text: next.join("\n"),
						},
					],
				});
				return true;
			}

			const file = this.fileFor(path);
			if (!file) return false;
			let ok = false;
			await this.app.vault.process(file, (data) => {
				const next = apply(data.split("\n"));
				if (!next) return data;
				ok = true;
				return next.join("\n");
			});
			return ok;
		});
	}

	/**
	 * The indent one level deeper than a task, matching the file's own style.
	 * A root task has no indent to copy, so its existing children are the only
	 * evidence of whether this file uses tabs or spaces.
	 */
	/* ---------------- sections ---------------- */

	/**
	 * The file's lines as they stand right now.
	 *
	 * From the editor when one is open, so an unsaved buffer is what gets read,
	 * and from the vault otherwise. Every caller re-verifies its anchor line
	 * before writing, so a stale read costs an abandoned edit and never a
	 * misplaced one.
	 */
	private async currentLines(path: string): Promise<string[] | null> {
		const editor = this.editorFor(path);
		if (editor) {
			const out: string[] = [];
			for (let i = 0; i < editor.lineCount(); i++) out.push(editor.getLine(i));
			return out;
		}
		const file = this.fileFor(path);
		if (!file) return null;
		return (await this.app.vault.read(file)).split("\n");
	}

	/**
	 * Rename the heading on `line`, keeping the level it was written at.
	 *
	 * Addressed by line rather than by name because a name does not identify a
	 * section: a list may have two called the same thing.
	 */
	async renameSection(path: string, line: number, name: string): Promise<void> {
		const clean = name.replace(/[\r\n]+/g, " ").trim();
		if (!clean) return;

		const lines = await this.currentLines(path);
		if (!lines) return;
		const raw = lines[line];
		if (raw === undefined) return;

		const h = HEADING_RE.exec(raw);
		if (!h) return;

		await this.replaceLine(path, line, raw, `${h[1]} ${clean}`);
	}

	/** Add an empty section at the end of the file. */
	async createSection(path: string, name: string): Promise<void> {
		const clean = name.replace(/[\r\n]+/g, " ").trim();
		if (!clean) return;

		const lines = await this.currentLines(path);
		if (!lines) return;

		// A blank line before the heading, unless the file already ends in one:
		// two headings jammed against the last task reads as part of it.
		const trailing = lines.length && lines[lines.length - 1].trim() === "";
		const insert = trailing ? [`## ${clean}`, ""] : ["", `## ${clean}`, ""];
		await this.insertLines(path, lines.length, insert);
	}

	/**
	 * Which heading a line sits under, as an index into `headingLines`.
	 *
	 * An index rather than a line number, because a task move shifts lines but
	 * never reorders headings — so the index still names the same heading on the
	 * other side of the splice, and a line number would not.
	 */
	private sectionIndexOf(lines: string[], line: number): number {
		const heads = this.headingLines(lines);
		let found = -1;
		for (let i = 0; i < heads.length; i++) {
			if (heads[i] > line) break;
			found = i;
		}
		return found;
	}

	/** Line numbers of every heading in the file, in order. */
	private headingLines(lines: string[]): number[] {
		const out: number[] = [];
		for (let i = 0; i < lines.length; i++) if (HEADING_RE.test(lines[i])) out.push(i);
		return out;
	}

	/**
	 * Delete a section.
	 *
	 * By default only the heading goes, and the tasks under it join the section
	 * above — deleting a column should not be a way to lose work by accident.
	 * `withTasks` is the deliberate version, and is what the confirm dialog asks
	 * about.
	 */
	async removeSection(
		path: string,
		line: number,
		opts: { withTasks?: boolean } = {}
	): Promise<void> {
		const lines = await this.currentLines(path);
		if (!lines) return;
		const raw = lines[line];
		if (raw === undefined || !HEADING_RE.test(raw)) return;

		if (!opts.withTasks) {
			await this.spliceLines(path, line, raw, line, 1, []);
			return;
		}

		// To the next heading, or to the end of the file.
		const next = this.headingLines(lines).find((h) => h > line) ?? lines.length;
		await this.spliceLines(path, line, raw, line, next - line, []);
	}

	/**
	 * Move a section to another position among its siblings.
	 *
	 * Rebuilt as a list of whole blocks rather than spliced by offset: a section
	 * is a heading plus everything under it, and reasoning about where that
	 * lands after a removal is where the off-by-ones live. Anything above the
	 * first heading is not part of any section and is never touched.
	 */
	async moveSection(path: string, line: number, toIndex: number): Promise<void> {
		const lines = await this.currentLines(path);
		if (!lines) return;
		const raw = lines[line];
		if (raw === undefined || !HEADING_RE.test(raw)) return;

		const heads = this.headingLines(lines);
		const from = heads.indexOf(line);
		if (from < 0) return;

		const to = Math.max(0, Math.min(heads.length - 1, toIndex));
		if (to === from) return;

		const blocks = heads.map((h, i) => lines.slice(h, heads[i + 1] ?? lines.length));
		const [moving] = blocks.splice(from, 1);
		blocks.splice(to, 0, moving);

		const start = heads[0];
		await this.spliceLines(path, line, raw, start, lines.length - start, blocks.flat());
	}

	/** First line of the body, i.e. past the frontmatter block if there is one. */
	private bodyStart(lines: string[]): number {
		if (lines[0]?.trim() !== "---") return 0;
		for (let i = 1; i < lines.length; i++) if (lines[i].trim() === "---") return i + 1;
		return 0;
	}

	/**
	 * Move a task into a different section.
	 *
	 * `reorder` assumes one contiguous run and splices within it. Crossing a
	 * heading is a different problem: the destination may hold nothing to aim
	 * at, or may be the space above the first heading where there is no heading
	 * either. So the insertion point is worked out from whatever the target
	 * offers — a sibling, a heading, or the top of the body.
	 *
	 * `sectionLine` is the heading being dropped into, or null for the ungrouped
	 * space above the first one.
	 */
	async moveToSection(
		task: Task,
		siblings: Task[],
		toIndex: number,
		sectionLine: number | null
	): Promise<void> {
		// The task never counts as its own drop target.
		const targets = siblings.filter((s) => s.line !== task.line);

		await this.applyLines(task.filePath, (lines) => {
			// Every anchor this move reads is re-verified. The indices came from
			// a parse that may be a frame or two old, and splicing against a file
			// that shifted underneath us would move the wrong block.
			if (lines[task.line] !== task.raw) return null;
			for (const t of targets) if (lines[t.line] !== t.raw) return null;
			if (sectionLine !== null && !HEADING_RE.test(lines[sectionLine] ?? "")) return null;

			const next = [...lines];
			// Taken before anything moves: afterwards the lines have shifted but
			// the headings are in the same order, so the indices still hold.
			const from = this.sectionIndexOf(lines, task.line);
			const dest =
				sectionLine === null ? -1 : this.sectionIndexOf(lines, sectionLine);

			const self = blockRange(task);
			const size = self.end - self.start;

			let at: number;
			if (targets.length) {
				const i = Math.max(0, Math.min(targets.length, toIndex));
				at =
					i >= targets.length
						? blockRange(targets[targets.length - 1]).end
						: blockRange(targets[i]).start;
			} else if (sectionLine !== null) {
				at = sectionLine + 1;
			} else {
				at = this.bodyStart(lines);
			}

			const moving = next.splice(self.start, size);
			// Removing the block shifts everything below it up, so a target that
			// sat after it has to be measured again.
			if (at > self.start) at -= size;
			next.splice(at, 0, ...moving);

			/*
			 * The heading the task just left, if nothing is under it any more.
			 *
			 * Part of the same write, so the move and the tidy are one edit and a
			 * file cannot be left with the task gone and the heading still there.
			 * The destination is never removed even when it is still empty — the
			 * task is in it, and a section you are dropping into is by definition
			 * one you want.
			 */
			if (this.autoRemoveEmptySections() && from >= 0 && from !== dest) {
				const heads = this.headingLines(next);
				const start = heads[from];
				if (start !== undefined) {
					const end = heads[from + 1] ?? next.length;
					const holds = next
						.slice(start + 1, end)
						.some((l) => parseLine(l, 0, task.filePath));
					if (!holds) next.splice(start, 1);
				}
			}

			return next;
		});
	}

	/**
	 * Nudge a section one place in either direction.
	 *
	 * The menu thinks in "up" and "down"; `moveSection` thinks in positions. A
	 * step past either end is deliberately nothing rather than a clamp, so the
	 * menu item at the end of the list is inert instead of silently rewriting
	 * the file to the order it already had.
	 */
	async moveSectionBy(path: string, line: number, delta: -1 | 1): Promise<void> {
		const lines = await this.currentLines(path);
		if (!lines) return;

		const heads = this.headingLines(lines);
		const from = heads.indexOf(line);
		if (from < 0) return;

		const to = from + delta;
		if (to < 0 || to >= heads.length) return;

		await this.moveSection(path, line, to);
	}

	private childIndent(task: Task): string {
		const child = task.children[0];
		if (child && child.indent.length > task.indent.length) return child.indent;
		const unit = task.indent.includes(" ") ? "    " : "\t";
		return task.indent + unit;
	}

	/**
	 * Set or clear a task's note — the indented prose directly beneath it.
	 * Existing note lines are replaced in place; a new note is inserted straight
	 * after the task line, before any steps, so it reads next to its task.
	 */
	async setNote(task: Task, text: string): Promise<void> {
		const clean = text.replace(/\r/g, "").trimEnd();
		if (clean === (task.note ?? "")) return;

		const indent = this.childIndent(task);
		// A paragraph break is written as a genuinely empty line. Indenting it
		// would leave a line of trailing whitespace that reads as blank but is
		// not, which editors and diffs both go on to quarrel about.
		//
		// A line that would read back as a step is escaped, so what the box is
		// given is what it gives back.
		const insert = clean
			? clean
					.split("\n")
					.map((l) => (l.trim() ? indent + escapeNoteLine(l.trim()) : ""))
			: [];

		const existing = [...task.noteLines].sort((a, b) => a - b);
		const contiguous =
			existing.length > 0 &&
			existing[existing.length - 1] - existing[0] === existing.length - 1;

		if (existing.length && contiguous) {
			await this.spliceLines(
				task.filePath,
				task.line,
				task.raw,
				existing[0],
				existing.length,
				insert
			);
			return;
		}

		if (existing.length) {
			// Scattered note lines: drop them all, then reinsert as one block.
			const file = this.fileFor(task.filePath);
			if (!file) return;
			await this.app.vault.process(file, (data) => {
				const lines = data.split("\n");
				if (lines[task.line] !== task.raw) return data;
				for (const n of [...existing].reverse()) lines.splice(n, 1);
				lines.splice(task.line + 1, 0, ...insert);
				return lines.join("\n");
			});
			return;
		}

		if (insert.length) {
			await this.spliceLines(
				task.filePath,
				task.line,
				task.raw,
				task.line + 1,
				0,
				insert
			);
		}
	}

	/* ---------------------------------------------------------------- *
	 * List operations
	 * ---------------------------------------------------------------- */

	/**
	 * Set or clear one frontmatter key on a list file.
	 *
	 * Goes through setFrontmatterKey rather than Obsidian's processFrontMatter,
	 * which round-trips the block through a YAML parser and can reorder keys.
	 * These files are the user's — one of them is a Kanban board whose plugin
	 * reads its own frontmatter back.
	 */
	async setListConfig(
		listPath: string,
		key: string,
		value: string | null
	): Promise<void> {
		const file = this.fileFor(listPath);
		if (!file) return;

		const editor = this.editorFor(listPath);
		if (editor) {
			const before = editor.getValue();
			const after = setFrontmatterKey(before, key, value);
			if (after === before) return;
			editor.setValue(after);
			return;
		}

		await this.app.vault.process(file, (data) => setFrontmatterKey(data, key, value));
	}

	/**
	 * Rename a list. The list's name IS its filename, so this renames the file
	 * and lets Obsidian update any links pointing at it.
	 *
	 * Returns the new path, or null if it did not happen.
	 */
	/**
	 * Delete a list.
	 *
	 * Through `fileManager.trashFile`, which honours the vault's "Deleted files"
	 * setting — the system trash, the vault's own `.trash`, or permanently —
	 * rather than deciding on the user's behalf. A list is a file somebody wrote,
	 * and how carefully it is thrown away is their setting to make, not ours.
	 */
	async deleteList(listPath: string): Promise<void> {
		const file = this.fileFor(listPath);
		if (!file) return;
		// Read before it goes, so undo has something to put back. The trashed
		// copy stays wherever the vault sent it; undo writes a new file with the
		// old contents, which is the most an API without an un-delete can offer.
		const before = await this.currentText(listPath);
		await this.app.fileManager.trashFile(file);
		this.note(listPath, before, null);
	}

	async renameList(listPath: string, name: string): Promise<string | null> {
		const file = this.fileFor(listPath);
		if (!file) return null;

		// Strip what macOS and Obsidian will not accept in a filename, rather
		// than failing on it.
		const clean = name
			.replace(/[\\/:*?"<>|#^[\]]/g, "")
			.replace(/\s+/g, " ")
			.trim();
		if (!clean) return null;

		const parent = file.parent?.path ?? "";
		const target = (parent && parent !== "/" ? `${parent}/` : "") + `${clean}.md`;
		if (target === listPath) return null;

		if (this.app.vault.getAbstractFileByPath(target)) {
			new Notice(`A list called "${clean}" already exists.`);
			return null;
		}

		try {
			await this.app.fileManager.renameFile(file, target);
			return target;
		} catch (err) {
			new Notice(`Could not rename: ${String(err)}`);
			return null;
		}
	}

	/* ---------------------------------------------------------------- *
	 * Task operations
	 * ---------------------------------------------------------------- */

	/** Toggle between todo and done, stamping or clearing the ✅ date. */
	async toggle(task: Task): Promise<void> {
		return this.group(async () => {
		const becomingDone = task.status !== "done";
		let next = setStatus(task, becomingDone ? "done" : "todo");

		const reparsed = parseLine(next, task.line, task.filePath);
		if (reparsed) {
			if (becomingDone && this.addDoneDate()) {
				next = setField(reparsed, "done", this.stamp(), this.dialect());
			} else if (!becomingDone) {
				next = setField(reparsed, "done", null, this.dialect());
			}
		}

		/*
		 * A repeating task leaves the next one behind.
		 *
		 * The new line goes in *before* the completed one, which is what Obsidian
		 * Tasks does and what reading order wants: the thing still to do sits
		 * above the record of the thing already done.
		 *
		 * Inserting first and replacing second would shift the line the replace is
		 * about to target, so the order here is load-bearing: complete the task,
		 * then insert above it.
		 */
		const repeated = becomingDone ? this.repeatLine(task) : null;

			await this.replaceLine(task.filePath, task.line, task.raw, next);
			if (repeated) {
				await this.insertLines(task.filePath, task.line, [repeated]);
			}
		});
	}

	/** Set an explicit status, e.g. from a context menu. */
	async setStatus(task: Task, status: TaskStatus): Promise<void> {
		await this.replaceLine(
			task.filePath,
			task.line,
			task.raw,
			setStatus(task, status)
		);
	}

	async rename(task: Task, title: string): Promise<void> {
		const clean = title.replace(/[\r\n]+/g, " ").trim();
		if (!clean || clean === task.title) return;
		await this.replaceLine(task.filePath, task.line, task.raw, setTitle(task, clean));
	}

	async setField(task: Task, field: MetaField, value: string | null): Promise<void> {
		await this.replaceLine(
			task.filePath,
			task.line,
			task.raw,
			setField(task, field, value, this.dialect())
		);
	}

	async setFields(
		task: Task,
		changes: Partial<Record<MetaField, string | null>>
	): Promise<void> {
		await this.replaceLine(
			task.filePath,
			task.line,
			task.raw,
			setFields(task, changes, this.dialect())
		);
	}

	async toggleMyDay(task: Task): Promise<void> {
		await this.setField(task, "myDay", task.meta.myDay ? null : "true");
	}

	/**
	 * The line for the next instance of a repeating task, or null if there is
	 * not one to make.
	 *
	 * Everything the task carries travels except the things that belong to *this*
	 * occurrence: it starts undone, with no completion date, and with its dates
	 * advanced. The created date is refreshed too, since the new instance is new.
	 */
	private repeatLine(task: Task): string | null {
		if (!task.meta.repeat) return null;

		const dates = nextOccurrence(
			task.meta.repeat,
			{ due: task.meta.due, scheduled: task.meta.scheduled },
			today()
		);
		if (!dates) return null;

		const meta: Partial<TaskMeta> = { ...task.meta, ...dates, done: undefined };
		if (this.addCreatedDate()) meta.created = this.stamp();
		else delete meta.created;

		return newTaskLine(task.title, {
			indent: task.indent,
			bullet: task.bullet,
			meta,
			dialect: this.dialect(),
		});
	}

	/** The star in the reference UI maps to high priority. */
	async toggleImportant(task: Task): Promise<void> {
		const isHigh = task.meta.priority === "high" || task.meta.priority === "highest";
		await this.setField(task, "priority", isHigh ? null : "high");
	}

	/**
	 * Give a task its own note.
	 *
	 * The escape hatch the one-file-per-task designs make compulsory. The line
	 * stays where it is and becomes a link — `- [ ] [[Title]] 📅 2026-09-01` —
	 * so the list still shows it, still sorts it, still ticks it off. Only the
	 * 5% of tasks that grow a life of their own pay for a file.
	 *
	 * Metadata deliberately stays on the line rather than moving into the note's
	 * frontmatter. The line is what the list reads, what Obsidian Tasks reads,
	 * and what survives this plugin being uninstalled; moving the due date into a
	 * file would make the task invisible to all three.
	 *
	 * Returns the new note's path, or null if nothing was written.
	 */
	async promote(task: Task, folder: string): Promise<string | null> {
		const file = this.fileFor(task.filePath);
		if (!file) return null;

		// Already a link? Promoting twice would nest one inside another.
		if (/\[\[[^\]]+\]\]/.test(task.title)) {
			new Notice("That task is already a note.");
			return null;
		}

		const name = fileSafe(task.title);
		if (!name) {
			new Notice("That task's name cannot be used as a filename.");
			return null;
		}

		const dir = folder.replace(/\/+$/, "");
		if (dir && !this.app.vault.getAbstractFileByPath(dir)) {
			await this.app.vault.createFolder(dir).catch(() => undefined);
		}

		// Never overwrite. A collision means a different task with the same name,
		// and quietly merging the two would lose one of them.
		let path = dir ? `${dir}/${name}.md` : `${name}.md`;
		let n = 1;
		while (this.app.vault.getAbstractFileByPath(path)) {
			n += 1;
			path = dir ? `${dir}/${name} ${n}.md` : `${name} ${n}.md`;
		}

		const body = [
			"---",
			`created: ${today()}`,
			`source: "[[${file.basename}]]"`,
			"---",
			"",
			`# ${task.title}`,
			"",
			task.note ?? "",
			"",
		].join("\n");

		await this.app.vault.create(path, body);

		// The link uses the display title, so renaming the note later is
		// Obsidian's problem to solve rather than ours.
		const linked = setTitle(task, `[[${title(path)}|${task.title}]]`);
		const ok = await this.replaceLine(task.filePath, task.line, task.raw, linked);
		return ok ? path : null;
	}

	/** Delete a task, its note, and everything nested under it. */
	async remove(task: Task): Promise<void> {
		const { start, end } = blockRange(task);
		await this.removeLines(task.filePath, start, end - start);
	}

	/**
	 * Add a task to a list. Appended after the last root task so it lands where
	 * the reference UI's "Add a Task" box implies, or at the end of the file if
	 * the list is empty.
	 */
	async addTask(
		listPath: string,
		title: string,
		meta: Partial<TaskMeta> = {},
		opts: {
			after?: Task;
			indent?: string;
			note?: string;
			/**
			 * The heading to add under, or null for the space above the first one.
			 * Absent means the end of the file, which is what this always did and
			 * what a list with no headings wants.
			 */
			section?: number | null;
		} = {}
	): Promise<void> {
		const clean = title.replace(/[\r\n]+/g, " ").trim();
		if (!clean) return;

		const full: Partial<TaskMeta> = { ...meta };
		if (this.addCreatedDate() && !full.created) full.created = this.stamp();

		const line = newTaskLine(clean, {
			indent: opts.indent ?? "",
			meta: full,
			dialect: this.dialect(),
		});

		let at: number;
		if (opts.after) {
			at = blockRange(opts.after).end;
		} else if (opts.section !== undefined) {
			/*
			 * The end of the named section, not the end of the file.
			 *
			 * Appending blindly put every new task into whichever section happened
			 * to be last, however far that was from the one being looked at. The
			 * end of a section is the line before the next heading, backed up past
			 * the blank lines that separate them — a task added below those reads
			 * as belonging to the gap rather than to the section.
			 */
			const lines = await this.currentLines(listPath);
			if (!lines) return;
			const heads = this.headingLines(lines);
			const start = opts.section === null ? this.bodyStart(lines) : opts.section + 1;
			let end = heads.find((h) => h >= start) ?? lines.length;
			while (end > start && lines[end - 1].trim() === "") end--;
			at = end;
		} else {
			const file = this.fileFor(listPath);
			if (!file) return;
			const content = await this.app.vault.cachedRead(file);
			at = content.split("\n").length;
		}
		const indent = opts.indent ?? "";
		const unit = indent.includes(" ") ? "    " : "\t";
		const noteLines = opts.note?.trim()
			? opts.note
					.replace(/\r/g, "")
					.trim()
					.split("\n")
					.map((l) =>
						l.trim() ? indent + unit + escapeNoteLine(l.trim()) : ""
					)
			: [];

		await this.insertLines(listPath, at, [line, ...noteLines]);
	}

	/** Add a nested step beneath a task. */
	async addStep(parent: Task, title: string): Promise<void> {
		const clean = title.replace(/[\r\n]+/g, " ").trim();
		if (!clean) return;
		const line = newTaskLine(clean, {
			indent: this.childIndent(parent),
			dialect: this.dialect(),
		});
		const at = blockRange(parent).end;
		await this.insertLines(parent.filePath, at, [line]);
	}

	/** Move a task one place up or down among its siblings. */
	async move(task: Task, siblings: Task[], delta: -1 | 1): Promise<void> {
		const idx = siblings.findIndex((s) => s.line === task.line);
		if (idx < 0) return;
		await this.reorder(task, siblings, idx + delta);
	}

	/**
	 * Move a task to an arbitrary position among its siblings — what a drag
	 * lands on.
	 *
	 * `toIndex` is read against the list as it stands *before* the move, which is
	 * the same frame of reference the drag preview uses: "put me where item 3 is
	 * now". Moving a task down therefore lands it after the item currently at
	 * that index, which is what the preview showed.
	 *
	 * The whole block travels — the task, its note lines and every step beneath
	 * it — because a task's children are only its children by virtue of sitting
	 * underneath it. Leaving them behind would silently reparent them.
	 *
	 * This goes through `Vault.process` even when the file is open in an editor,
	 * unlike the single-line edits. A block move is several splices that must not
	 * be observed half-applied, and the atomic read-modify-write is the only path
	 * that guarantees that. The cost is the editor's cursor and folds, which a
	 * drag does not depend on the way typing does.
	 */
	async reorder(task: Task, siblings: Task[], toIndex: number): Promise<void> {
		const from = siblings.findIndex((s) => s.line === task.line);
		if (from < 0) return;

		const to = Math.max(0, Math.min(siblings.length - 1, toIndex));
		if (to === from) return;

		const self = blockRange(task);
		const block = self.end - self.start;
		const target = siblings[to];
		const targetRange = blockRange(target);

		await this.applyLines(task.filePath, (lines) => {
			// Every sibling's first line is re-verified, not just the two being
			// swapped. The indices came from a parse that may be a frame or two
			// old, and splicing against a file that has shifted underneath us
			// would move the wrong block.
			for (const s of siblings) {
				if (lines[s.line] !== s.raw) return null;
			}

			const next = [...lines];
			const moving = next.splice(self.start, block);
			// Splicing the block out shifts everything below it up by `block`
			// lines, so a downward move has to be measured after the removal.
			const insertAt = to < from ? targetRange.start : targetRange.end - block;
			next.splice(insertAt, 0, ...moving);
			return next;
		});
	}
}

/**
 * A filename that macOS, Windows and Obsidian will all accept.
 *
 * Shared with renameList's own cleaning: the same characters are illegal
 * wherever a name becomes a path.
 */
export function fileSafe(name: string): string {
	return name
		.replace(/\[\[|\]\]/g, "")
		.replace(/[\\/:*?"<>|#^]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 120);
}

/** The display name of a path: no folders, no extension. */
function title(path: string): string {
	return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}
