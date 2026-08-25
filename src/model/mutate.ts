import { App, MarkdownView, TFile } from "obsidian";
import { parseLine } from "./parse";
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
export class Mutator {
	private app: App;
	private dialect: () => Dialect;
	private addDoneDate: () => boolean;
	private addCreatedDate: () => boolean;

	constructor(
		app: App,
		opts: {
			dialect: () => Dialect;
			addDoneDate: () => boolean;
			addCreatedDate: () => boolean;
		}
	) {
		this.app = app;
		this.dialect = opts.dialect;
		this.addDoneDate = opts.addDoneDate;
		this.addCreatedDate = opts.addCreatedDate;
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
	private async replaceLine(
		path: string,
		line: number,
		expect: string,
		next: string
	): Promise<boolean> {
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
	}

	/** Insert lines at a position, pushing the rest down. */
	private async insertLines(
		path: string,
		at: number,
		text: string[]
	): Promise<boolean> {
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
	}

	/** Remove a range of lines. */
	private async removeLines(path: string, from: number, count: number): Promise<boolean> {
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
	}

	/**
	 * The indent one level deeper than a task, matching the file's own style.
	 * A root task has no indent to copy, so its existing children are the only
	 * evidence of whether this file uses tabs or spaces.
	 */
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
		const insert = clean ? clean.split("\n").map((l) => indent + l.trim()) : [];

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
	 * Task operations
	 * ---------------------------------------------------------------- */

	/** Toggle between todo and done, stamping or clearing the ✅ date. */
	async toggle(task: Task): Promise<void> {
		const becomingDone = task.status !== "done";
		let next = setStatus(task, becomingDone ? "done" : "todo");

		const reparsed = parseLine(next, task.line, task.filePath);
		if (reparsed) {
			if (becomingDone && this.addDoneDate()) {
				next = setField(reparsed, "done", today(), this.dialect());
			} else if (!becomingDone) {
				next = setField(reparsed, "done", null, this.dialect());
			}
		}
		await this.replaceLine(task.filePath, task.line, task.raw, next);
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

	/** The star in the reference UI maps to high priority. */
	async toggleImportant(task: Task): Promise<void> {
		const isHigh = task.meta.priority === "high" || task.meta.priority === "highest";
		await this.setField(task, "priority", isHigh ? null : "high");
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
		opts: { after?: Task; indent?: string; note?: string } = {}
	): Promise<void> {
		const clean = title.replace(/[\r\n]+/g, " ").trim();
		if (!clean) return;

		const full: Partial<TaskMeta> = { ...meta };
		if (this.addCreatedDate() && !full.created) full.created = today();

		const line = newTaskLine(clean, {
			indent: opts.indent ?? "",
			meta: full,
			dialect: this.dialect(),
		});

		let at: number;
		if (opts.after) {
			at = blockRange(opts.after).end;
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
					.map((l) => indent + unit + l.trim())
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

	/** Move a root task up or down among its siblings. */
	async move(task: Task, siblings: Task[], delta: -1 | 1): Promise<void> {
		const idx = siblings.findIndex((s) => s.line === task.line);
		const target = siblings[idx + delta];
		if (idx < 0 || !target) return;

		const file = this.fileFor(task.filePath);
		if (!file) return;

		const self = blockRange(task);
		const other = blockRange(target);
		const block = self.end - self.start;
		const targetBlock = other.end - other.start;

		await this.app.vault.process(file, (data) => {
			const lines = data.split("\n");
			if (lines[task.line] !== task.raw || lines[target.line] !== target.raw) {
				return data; // stale parse, do nothing
			}
			const moving = lines.splice(task.line, block);
			const insertAt =
				delta === -1 ? target.line : target.line + targetBlock - block;
			lines.splice(insertAt, 0, ...moving);
			return lines.join("\n");
		});
	}
}

