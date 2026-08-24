import { ItemView, WorkspaceLeaf } from "obsidian";
import type ListsPlugin from "../main";
import { PaneName, Selection, ViewContext, ViewState } from "./context";
import { renderListsPane } from "./panes/ListsPane";
import { renderTasksPane } from "./panes/TasksPane";
import { renderDetailPane } from "./panes/DetailPane";
import { Task } from "../model/types";

export const VIEW_TYPE_LISTS = "lists-view";

/** Below this width the panes stack and navigate instead of sitting side by side. */
const WIDE_BREAKPOINT = 700;

export class ListsView extends ItemView {
	private plugin: ListsPlugin;
	private state: ViewState;
	private unsubscribe: (() => void) | null = null;
	private observer: ResizeObserver | null = null;
	private wide = false;
	private queued = false;

	constructor(leaf: WorkspaceLeaf, plugin: ListsPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.state = {
			selection: plugin.settings.lastList
				? { kind: "list", path: plugin.settings.lastList }
				: { kind: "smart", view: "myday" },
			selectedTask: null,
			pane: "nav",
			completedOpen: plugin.settings.showCompleted === "expanded",
		};
	}

	getViewType(): string {
		return VIEW_TYPE_LISTS;
	}

	/**
	 * Shown as a tooltip on desktop, but as a real text label in the mobile
	 * drawer's tab list — so this needs to read as a name, not a description.
	 */
	getDisplayText(): string {
		return "Lists";
	}

	getIcon(): string {
		return "list-todo";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("lists-root");
		this.unsubscribe = this.plugin.store.onChange(() => this.render());

		// Repaint on width change so the layout can switch between one and three
		// panes without the user reopening anything.
		this.observer = new ResizeObserver(() => this.onResize());
		this.observer.observe(this.contentEl);

		this.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.observer?.disconnect();
		this.observer = null;
	}

	onResize(): void {
		const wide = this.contentEl.clientWidth >= WIDE_BREAKPOINT;
		if (wide !== this.wide) this.render();
	}

	/** Jump straight to a selection, e.g. from a command. */
	reveal(sel: Selection): void {
		this.state.selection = sel;
		this.state.selectedTask = null;
		this.state.pane = "tasks";
		this.render();
	}

	private buildContext(): ViewContext {
		return {
			app: this.app,
			store: this.plugin.store,
			mutator: this.plugin.mutator,
			settings: this.plugin.settings,
			state: this.state,
			wide: this.wide,
			render: () => this.render(),
			save: () => this.plugin.saveSettings(),
			select: (sel: Selection) => {
				this.state.selection = sel;
				this.state.selectedTask = null;
				if (sel.kind === "list") {
					this.plugin.settings.lastList = sel.path;
					void this.plugin.saveSettings();
				}
				if (!this.wide) this.state.pane = "tasks";
				this.render();
			},
			selectTask: (task: Task | null) => {
				this.state.selectedTask = task
					? { filePath: task.filePath, line: task.line }
					: null;
				this.render();
			},
			showPane: (pane: PaneName) => {
				this.state.pane = pane;
				this.render();
			},
		};
	}

	/** Coalesce repaints so a burst of file events costs one pass. */
	render(): void {
		if (this.queued) return;
		this.queued = true;
		window.requestAnimationFrame(() => {
			this.queued = false;
			this.paint();
		});
	}

	private paint(): void {
		this.wide = this.contentEl.clientWidth >= WIDE_BREAKPOINT;

		// Preserve scroll position across repaints, otherwise checking off a task
		// jumps a long list back to the top.
		const scrollTops = new Map<string, number>();
		this.contentEl.findAll(".lists-scroll, .lists-nav-scroll").forEach((el, i) => {
			scrollTops.set(String(i), el.scrollTop);
		});

		// Keep focus on the add box if that is where the user was typing.
		const active = document.activeElement as HTMLElement | null;
		const refocus =
			active && this.contentEl.contains(active)
				? active.className.split(" ").find((c) => c.startsWith("lists-"))
				: undefined;
		const caret =
			active instanceof HTMLInputElement ? active.selectionStart : null;
		const typed = active instanceof HTMLInputElement ? active.value : null;

		this.contentEl.empty();
		this.contentEl.toggleClass("is-wide", this.wide);
		this.contentEl.toggleClass("is-narrow", !this.wide);

		const ctx = this.buildContext();
		const shell = this.contentEl.createDiv({ cls: "lists-shell" });
		shell.dataset.pane = this.state.pane;

		if (this.wide) {
			renderListsPane(shell, ctx);
			renderTasksPane(shell, ctx);
			renderDetailPane(shell, ctx);
		} else {
			switch (this.state.pane) {
				case "nav":
					renderListsPane(shell, ctx);
					break;
				case "tasks":
					renderTasksPane(shell, ctx);
					break;
				case "detail":
					renderDetailPane(shell, ctx);
					break;
			}
		}

		this.contentEl.findAll(".lists-scroll, .lists-nav-scroll").forEach((el, i) => {
			const t = scrollTops.get(String(i));
			if (t) el.scrollTop = t;
		});

		if (refocus) {
			const el = this.contentEl.querySelector<HTMLElement>(`.${refocus}`);
			if (el) {
				el.focus();
				if (el instanceof HTMLInputElement && typed !== null) {
					el.value = typed;
					if (caret !== null) el.setSelectionRange(caret, caret);
				}
			}
		}
	}
}
