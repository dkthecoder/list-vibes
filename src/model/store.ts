import { App, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { datePart, timePart } from "./datetime";
import { parseFile } from "./parse";
import { Task, TaskList, isComplete } from "./types";

export type SmartView = "myday" | "important" | "planned" | "all";

/**
 * Reads the lists folder and keeps an in-memory view of it.
 *
 * There is deliberately no database and no persisted index here. The files are
 * the state; this is a cache of a few kilobytes of parse output, rebuilt from
 * disk whenever Obsidian tells us a file changed. Keeping it that way is what
 * stops this plugin growing the query layer it does not need.
 */
export class ListStore {
	private app: App;
	private folder: string;
	private lists = new Map<string, TaskList>();
	private listeners = new Set<() => void>();
	private pending: number | null = null;

	constructor(app: App, folder: string) {
		this.app = app;
		this.folder = normalizePath(folder);
	}

	setFolder(folder: string) {
		this.folder = normalizePath(folder);
		void this.reloadAll();
	}

	getFolder(): string {
		return this.folder;
	}

	onChange(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private emit() {
		// Coalesce bursts (a rename fires several events) into one repaint.
		if (this.pending !== null) window.clearTimeout(this.pending);
		this.pending = window.setTimeout(() => {
			this.pending = null;
			for (const fn of this.listeners) fn();
		}, 30);
	}

	/** True if the file belongs to the lists folder. */
	isListFile(file: TAbstractFile): file is TFile {
		return (
			file instanceof TFile &&
			file.extension === "md" &&
			file.path.startsWith(this.folder + "/")
		);
	}

	async reloadAll(): Promise<void> {
		this.lists.clear();
		const folder = this.app.vault.getAbstractFileByPath(this.folder);
		if (!(folder instanceof TFolder)) {
			this.emit();
			return;
		}
		const files = folder.children.filter(
			(c): c is TFile => c instanceof TFile && c.extension === "md"
		);
		await Promise.all(files.map((f) => this.reloadFile(f, false)));
		this.emit();
	}

	async reloadFile(file: TFile, emit = true): Promise<void> {
		try {
			const content = await this.app.vault.cachedRead(file);
			this.lists.set(file.path, parseFile(content, file.path));
		} catch {
			this.lists.delete(file.path);
		}
		if (emit) this.emit();
	}

	removeFile(path: string) {
		if (this.lists.delete(path)) this.emit();
	}

	/** All lists, sorted by name. */
	getLists(): TaskList[] {
		return [...this.lists.values()].sort((a, b) =>
			a.name.localeCompare(b.name, undefined, { numeric: true })
		);
	}

	getList(path: string): TaskList | undefined {
		return this.lists.get(path);
	}

	/** Every root-level task across every list. */
	private allRootTasks(): Task[] {
		return this.getLists().flatMap((l) => l.tasks);
	}

	/**
	 * Tasks for a smart view. Completed tasks are excluded from all of them
	 * except "all", which keeps them so the Completed section still works.
	 */
	getSmartView(view: SmartView): Task[] {
		const open = this.allRootTasks().filter((t) => !isComplete(t));
		switch (view) {
			case "myday":
				return open.filter((t) => t.meta.myDay || isToday(t.meta.due));
			case "important":
				return open.filter(
					(t) => t.meta.priority === "high" || t.meta.priority === "highest"
				);
			case "planned":
				return open
					.filter((t) => t.meta.due || t.meta.scheduled)
					.sort((a, b) =>
						(a.meta.due ?? a.meta.scheduled ?? "").localeCompare(
							b.meta.due ?? b.meta.scheduled ?? ""
						)
					);
			case "all":
				return this.allRootTasks();
		}
	}

	countSmartView(view: SmartView): number {
		return this.getSmartView(view).filter((t) => !isComplete(t)).length;
	}

	/** Look a task back up after a reparse, by file and line. */
	findTask(filePath: string, line: number): Task | undefined {
		return this.lists.get(filePath)?.all.find((t) => t.line === line);
	}
}

/* ------------------------------------------------------------------ *
 * Date helpers, local time throughout
 * ------------------------------------------------------------------ */

export function todayISO(): string {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function isToday(iso?: string): boolean {
	return !!iso && datePart(iso) === todayISO();
}

/**
 * A stamp as a person reads it: "Today at 14:32", or just the day when there is
 * no time in it.
 *
 * "Today" on its own is the least informative thing a completed task can say,
 * and by tomorrow it says less. The time is what makes a day's completions
 * readable as a sequence.
 */
export function formatStamp(stamp?: string): string {
	if (!stamp) return "";
	const day = formatDate(stamp);
	const time = timePart(stamp);
	return time ? `${day} at ${formatTime(time)}` : day;
}

export function isOverdue(iso?: string): boolean {
	return !!iso && iso < todayISO();
}

/** "Today", "Tomorrow", "Mon, 25 Aug" — the label style the reference UI uses. */
export function formatDate(iso?: string): string {
	if (!iso) return "";
	// A stamp may carry a time; the day is what this names.
	const day = datePart(iso);
	const today = todayISO();
	if (day === today) return "Today";

	const d = new Date(day + "T00:00:00");
	const now = new Date(today + "T00:00:00");
	const days = Math.round((d.getTime() - now.getTime()) / 86400000);
	if (days === 1) return "Tomorrow";
	if (days === -1) return "Yesterday";

	const sameYear = d.getFullYear() === now.getFullYear();
	return d.toLocaleDateString(undefined, {
		weekday: days > -7 && days < 7 ? "short" : undefined,
		day: "numeric",
		month: "short",
		year: sameYear ? undefined : "numeric",
	});
}

/** "11:00" -> "11:00 AM" where the locale wants it. */
export function formatTime(hhmm?: string): string {
	if (!hhmm) return "";
	const [h, m] = hhmm.split(":").map(Number);
	if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
	const d = new Date();
	d.setHours(h, m, 0, 0);
	return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
