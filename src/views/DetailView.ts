import { ItemView, ViewStateResult, WorkspaceLeaf } from "obsidian";
import type ListsPlugin from "../main";
import { DetailContext, ViewState } from "./context";
import { renderDetailPane } from "./panes/DetailPane";
import { decodeTaskRef, encodeTaskRef } from "./viewState";
import { Task } from "../model/types";
import { prettifyName } from "../ui/prettify";
import { splitIcon } from "../model/parse";

export const VIEW_TYPE_DETAIL = "list-vibes-detail";

/**
 * The task detail, as a panel of Obsidian's own rather than an overlay of ours.
 *
 * It began as a sheet sliding over the list, which meant building the things a
 * panel already has: a close button, a backdrop, swipe-to-dismiss, and a
 * back-button handler so Android's back key closed the sheet instead of leaving
 * the app. All of that is what Obsidian's right split does for free, for every
 * view in it, in the way the user already expects — collapse it, drag it wider,
 * and on a phone swipe the drawer away.
 *
 * Registering a second view type is the whole trick. Backlinks and Outline are
 * ordinary views that happen to live on the right; so is this.
 *
 * It holds only a reference — a file and a line — and looks the task up on
 * every paint. A task is a line in a file that anything may rewrite, so a cached
 * copy is a copy that goes stale; the reference survives a reparse and the
 * lookup is a map read.
 */
export class DetailView extends ItemView {
	private plugin: ListsPlugin;
	private state: ViewState;
	private unsubscribe: (() => void) | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ListsPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.state = {
			selection: { kind: "smart", view: "all" },
			selectedTask: null,
			pane: "detail",
			completedOpen: false,
			composing: false,
			openAction: null,
			draft: {},
		};
	}

	getViewType(): string {
		return VIEW_TYPE_DETAIL;
	}

	getIcon(): string {
		return "square-pen";
	}

	/**
	 * Which list the task belongs to, in Obsidian's own header.
	 *
	 * The overlay drew this itself, under Obsidian's header, which was two bars
	 * of furniture above one task. A panel's name is the header's job.
	 */
	getDisplayText(): string {
		const task = this.task();
		if (!task) return "Task";
		const base = task.filePath.split("/").pop()?.replace(/\.md$/, "") ?? "";
		const name = splitIcon(base).name;
		return this.plugin.settings.prettyTitles ? prettifyName(name) : name;
	}

	/** The task this panel is showing, looked up fresh. */
	private task(): Task | undefined {
		const ref = this.state.selectedTask;
		return ref ? this.plugin.store.findTask(ref.filePath, ref.line) : undefined;
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("lv-root", "lv-detail-host");
		// A file changing can change what this panel shows, or remove the task
		// it is showing altogether, so it repaints on the same signal the list does.
		this.unsubscribe = this.plugin.store.onChange(() => this.render());
		this.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	getState(): Record<string, unknown> {
		return { ...encodeTaskRef(this.state.selectedTask) };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		this.state.selectedTask = decodeTaskRef(state);
		this.state.openAction = null;
		this.render();
		await super.setState(state, result);
	}

	/** Point the panel at a task from outside, e.g. a tap in a list. */
	show(task: Task | null): void {
		this.state.selectedTask = task
			? { filePath: task.filePath, line: task.line }
			: null;
		this.state.openAction = null;
		this.render();
		// Keep the leaf's own record honest, so a restart reopens what is here.
		void this.leaf.setViewState({
			type: VIEW_TYPE_DETAIL,
			state: this.getState(),
		});
	}

	private context(): DetailContext {
		return {
			app: this.app,
			store: this.plugin.store,
			mutator: this.plugin.mutator,
			settings: this.plugin.settings,
			state: this.state,
			render: () => this.render(),
			save: () => this.plugin.saveSettings(),
			selectTask: (task) => this.show(task),
			promote: (task) => void this.plugin.promote(task),
		};
	}

	private render(): void {
		this.contentEl.empty();
		const task = this.task();
		if (!task) {
			this.renderEmpty();
		} else {
			renderDetailPane(this.contentEl, this.context());
		}

	}

	/**
	 * What the panel says with nothing selected.
	 *
	 * Which is most of the time, in a vault: the panel is docked on the right
	 * and stays there while the user reads notes. Obsidian's own panels answer
	 * this by describing what they would show — Backlinks says "No file" — so
	 * this says what it needs and offers the way to give it: pick a list, then
	 * pick a task, without leaving the panel.
	 */
	private renderEmpty(): void {
		const empty = this.contentEl.createDiv({ cls: "lv-pane lv-detail lv-detail-empty" });
		const scroll = empty.createDiv({ cls: "lv-scroll" });
		const box = scroll.createDiv({ cls: "lv-empty" });
		box.createDiv({ cls: "lv-empty-title", text: "No task selected" });
		box.createDiv({
			cls: "lv-empty-body",
			text: "Pick one from a list, or choose a task here.",
		});
		const pick = box.createEl("button", { cls: "mod-cta", text: "Choose a task" });
		pick.addEventListener("click", () => void this.plugin.pickTask((t: Task | null) => this.show(t)));
	}
}
