/**
 * Core data model.
 *
 * Design rule that everything else depends on: a Task always carries the exact
 * original line it came from (`raw`), and every mutation is a surgical splice
 * into that string. We never regenerate a line from parsed fields. That is what
 * guarantees a file we did not mean to change cannot drift.
 */

export type Priority = "highest" | "high" | "medium" | "low" | "lowest";

/** Which inline syntax to emit when writing. We always parse both. */
export type Dialect = "emoji" | "dataview";

/** A metadata field that can live inline on a task line. */
export type MetaField =
	| "created"
	| "start"
	| "scheduled"
	| "due"
	| "done"
	| "cancelled"
	| "repeat"
	| "reminder"
	| "myDay"
	| "priority"
	| "id"
	| "dependsOn"
	| "onCompletion";

/**
 * A metadata token located in the raw line.
 * `start`/`end` are offsets into the raw line, so a token can be replaced or
 * excised without disturbing anything around it.
 */
export interface MetaToken {
	field: MetaField;
	/** Raw value text as written, e.g. "2026-08-24" or "every week". */
	value: string;
	start: number;
	end: number;
	dialect: Dialect;
}

export interface TaskMeta {
	created?: string;
	start?: string;
	scheduled?: string;
	due?: string;
	done?: string;
	cancelled?: string;
	/** Free text recurrence rule, e.g. "every week". */
	repeat?: string;
	/** HH:MM, 24h. */
	reminder?: string;
	myDay?: boolean;
	priority?: Priority;
	id?: string;
	dependsOn?: string;
	onCompletion?: string;
	/** #tags found in the title. Left in place in the raw line. */
	tags: string[];
}

/**
 * Obsidian's own reading of `ListItemCache.task` is binary — any character that
 * is not a space counts as done. We keep the raw character and apply our own
 * interpretation, so `[/]` and `[-]` stay distinguishable.
 */
export type TaskStatus = "todo" | "done" | "inProgress" | "cancelled";

export interface Task {
	/** Vault-relative path of the list file. */
	filePath: string;
	/** 0-based line number. */
	line: number;

	/** The complete original line, verbatim. */
	raw: string;
	/** Leading whitespace, verbatim (tabs or spaces as the user wrote them). */
	indent: string;
	/** Bullet token as written: "-", "*", "+", "1.", "2)" … */
	bullet: string;
	/** The single character between the brackets. */
	statusChar: string;
	/** Our interpretation of statusChar. */
	status: TaskStatus;

	/** Offset in `raw` of the character inside the brackets. */
	statusOffset: number;
	/** Offset range in `raw` of the title text, metadata excluded. */
	titleStart: number;
	titleEnd: number;

	/** Title with metadata tokens removed and trimmed. Markdown is preserved. */
	title: string;
	meta: TaskMeta;
	tokens: MetaToken[];

	/** Line number of the parent list item, or -1 if this is a root item. */
	parentLine: number;
	/** 0 for root-level tasks. */
	depth: number;
	children: Task[];

	/** Heading this task sits under, if any, e.g. "US / English". */
	section?: string;

	/** Indented free text directly beneath the task, i.e. the note field. */
	note?: string;
	/** Exact line numbers the note occupies, so it can be edited or removed. */
	noteLines: number[];
}

/**
 * The half-open line range [start, end) a task owns: its own line, its note,
 * and every nested descendant. Computed from recorded line numbers rather than
 * by counting, because notes and children can interleave.
 */
export function blockRange(task: Task): { start: number; end: number } {
	let max = task.line;
	const visit = (t: Task) => {
		max = Math.max(max, t.line);
		for (const n of t.noteLines) max = Math.max(max, n);
		
		for (const c of t.children) visit(c);
	};
	visit(task);
	return { start: task.line, end: max + 1 };
}

/** How a list's tasks are laid out. */
export type ViewMode = "list" | "postit";

/**
 * Read a layout name from a file or from saved settings.
 *
 * The post-it wall was called "cards" in earlier versions, and that name is on
 * disk in real vaults — in list frontmatter, which is the user's file and not
 * ours to rewrite, and in data.json. It is accepted here forever rather than
 * migrated, because a silent rewrite of somebody's frontmatter to fix our own
 * naming is not a trade worth making. Anything unrecognised falls back to rows.
 */
export function normalizeViewMode(value: unknown): ViewMode | undefined {
	if (value === "postit" || value === "cards") return "postit";
	if (value === "list") return "list";
	return undefined;
}

/**
 * The named colours a list can carry. Stored by name rather than as a hex
 * value so the actual colour can differ between light and dark themes.
 */
export const LIST_COLORS = [
	"red",
	"orange",
	"yellow",
	"green",
	"teal",
	"blue",
	"purple",
	"pink",
	"grey",
] as const;

export type ListColor = (typeof LIST_COLORS)[number];

export function isListColor(v: unknown): v is ListColor {
	return typeof v === "string" && (LIST_COLORS as readonly string[]).includes(v);
}

/** Frontmatter settings a list file may carry. */
export interface ListConfig {
	icon?: string;
	color?: ListColor;
	view?: ViewMode;
	sort?: "manual" | "due" | "priority" | "alpha" | "created";
	showCompleted?: "collapsed" | "expanded" | "hidden";
	/** Absent means "whatever the setting says"; see `stripeRows`. */
	stripes?: boolean;
	defaultDue?: string;
}

/** A `##` heading, and the line it is written on. */
export interface ListSection {
	name: string;
	/** 0-based line number of the heading itself. */
	line: number;
}

export interface TaskList {
	/** Vault-relative path. */
	path: string;
	/** Filename without extension, used as the display name. */
	name: string;
	config: ListConfig;
	/** Headings in file order, each with the line it is written on. */
	sections: ListSection[];
	/** Root-level tasks, in file order. Children hang off `Task.children`. */
	tasks: Task[];
	/** Every task, flattened, in file order. */
	all: Task[];
}

export const STATUS_CHARS: Record<TaskStatus, string> = {
	todo: " ",
	done: "x",
	inProgress: "/",
	cancelled: "-",
};

export function statusFromChar(c: string): TaskStatus {
	switch (c) {
		case " ":
			return "todo";
		case "/":
			return "inProgress";
		case "-":
			return "cancelled";
		default:
			return "done";
	}
}

export function isComplete(t: Task): boolean {
	return t.status === "done" || t.status === "cancelled";
}
