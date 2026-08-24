/**
 * Surgical edits to a task's raw line.
 *
 * Every function here takes the original line and returns a new one that
 * differs only in the region being changed. Nothing is ever rebuilt from the
 * parsed model, so formatting we did not target survives untouched.
 */

import { EMOJI_FOR_FIELD, EMOJI_FOR_PRIORITY, parseLine } from "./parse";
import { Dialect, MetaField, Priority, Task, TaskMeta, TaskStatus, STATUS_CHARS } from "./types";

interface Edit {
	start: number;
	end: number;
	text: string;
}

/** Apply edits right-to-left so earlier offsets stay valid. */
function applyEdits(raw: string, edits: Edit[]): string {
	const sorted = [...edits].sort((a, b) => b.start - a.start);
	let out = raw;
	for (const e of sorted) {
		out = out.slice(0, e.start) + e.text + out.slice(e.end);
	}
	return out;
}

/** Dataview key to write for each field. */
const DATAVIEW_KEY: Partial<Record<MetaField, string>> = {
	created: "created",
	start: "start",
	scheduled: "scheduled",
	due: "due",
	done: "completion",
	cancelled: "cancelled",
	repeat: "repeat",
	reminder: "reminder",
	myDay: "myday",
	priority: "priority",
	id: "id",
	dependsOn: "dependsOn",
	onCompletion: "onCompletion",
};

/** Render one metadata token in the given dialect. */
export function renderToken(
	field: MetaField,
	value: string,
	dialect: Dialect
): string {
	if (dialect === "dataview") {
		const key = DATAVIEW_KEY[field] ?? field;
		return `[${key}:: ${value}]`;
	}
	if (field === "priority") {
		return EMOJI_FOR_PRIORITY[value as Priority] ?? "";
	}
	if (field === "myDay") {
		return EMOJI_FOR_FIELD.myDay ?? "☀️";
	}
	const glyph = EMOJI_FOR_FIELD[field];
	if (!glyph) return "";
	return `${glyph} ${value}`;
}

/** Change the character between the brackets. */
export function setStatusChar(task: Task, char: string): string {
	return applyEdits(task.raw, [
		{ start: task.statusOffset, end: task.statusOffset + 1, text: char },
	]);
}

export function setStatus(task: Task, status: TaskStatus): string {
	return setStatusChar(task, STATUS_CHARS[status]);
}

/**
 * Set or clear one metadata field.
 * Pass null to remove it. Returns the new raw line.
 */
export function setField(
	task: Task,
	field: MetaField,
	value: string | null,
	dialect: Dialect
): string {
	const existing = task.tokens.filter((t) => t.field === field);

	// Removing: excise every token for this field, plus one adjacent space.
	if (value === null) {
		const edits: Edit[] = existing.map((t) => {
			let start = t.start;
			if (start > 0 && /[ \t]/.test(task.raw[start - 1])) start -= 1;
			return { start, end: t.end, text: "" };
		});
		return edits.length ? applyEdits(task.raw, edits) : task.raw;
	}

	// Updating: replace the first token in place, drop any duplicates.
	if (existing.length) {
		const first = existing[0];
		const text = renderToken(field, value, first.dialect);
		const edits: Edit[] = [{ start: first.start, end: first.end, text }];
		for (const dup of existing.slice(1)) {
			let start = dup.start;
			if (start > 0 && /[ \t]/.test(task.raw[start - 1])) start -= 1;
			edits.push({ start, end: dup.end, text: "" });
		}
		return applyEdits(task.raw, edits);
	}

	// Adding: append at end of line, before any trailing whitespace or CR.
	const trimmed = task.raw.replace(/[ \t\r]+$/, "");
	const trail = task.raw.slice(trimmed.length);
	const sep = trimmed.endsWith("]") || /[ \t]$/.test(trimmed) ? "" : " ";
	return trimmed + sep + renderToken(field, value, dialect) + trail;
}

/** Apply several field changes in one pass, so offsets stay consistent. */
export function setFields(
	task: Task,
	changes: Partial<Record<MetaField, string | null>>,
	dialect: Dialect
): string {
	let line = task.raw;
	let current: Task | null = task;
	for (const [field, value] of Object.entries(changes)) {
		if (!current) break;
		line = setField(current, field as MetaField, value ?? null, dialect);
		// Reparse so the next edit sees correct offsets.
		current = parseLine(line, task.line, task.filePath);
	}
	return line;
}

/** Replace the task's title text, leaving metadata and indentation alone. */
export function setTitle(task: Task, title: string): string {
	return applyEdits(task.raw, [
		{ start: task.titleStart, end: task.titleEnd, text: title },
	]);
}

/** Build a brand new task line. */
export function newTaskLine(
	title: string,
	opts: {
		indent?: string;
		bullet?: string;
		status?: TaskStatus;
		meta?: Partial<TaskMeta>;
		dialect?: Dialect;
	} = {}
): string {
	const indent = opts.indent ?? "";
	const bullet = opts.bullet ?? "-";
	const status = STATUS_CHARS[opts.status ?? "todo"];
	const dialect = opts.dialect ?? "emoji";

	let line = `${indent}${bullet} [${status}] ${title.trim()}`;

	const meta = opts.meta ?? {};
	// Emit in a stable order so lines look consistent.
	const order: MetaField[] = [
		"myDay",
		"priority",
		"reminder",
		"scheduled",
		"due",
		"repeat",
		"created",
		"done",
	];
	for (const field of order) {
		const v = (meta as Record<string, unknown>)[field];
		if (v === undefined || v === null || v === false || v === "") continue;
		const value = v === true ? "true" : String(v);
		line += " " + renderToken(field, value, dialect);
	}
	return line;
}

/** Today as YYYY-MM-DD in local time. */
export function today(): string {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
