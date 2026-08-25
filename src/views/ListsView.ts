import { ItemView, Scope, WorkspaceLeaf } from "obsidian";
import type ListsPlugin from "../main";
import { PaneName, Selection, ViewContext, ViewState } from "./context";
import { renderListsPane } from "./panes/ListsPane";
import { renderTasksPane } from "./panes/TasksPane";
import { renderDetailPane } from "./panes/DetailPane";
import { Task } from "../model/types";
import { SortKey } from "../model/sort";

export const VIEW_TYPE_LISTS = "lists-view";

/**
 * Above this width the list picker and the task list sit side by side.
 * The detail panel is never a column — it always slides over.
 */
const WIDE_BREAKPOINT = 620;

export class ListsView extends ItemView {
	private plugin: ListsPlugin;
	private state: ViewState;
	private unsubscribe: (() => void) | null = null;
	private observer: ResizeObserver | null = null;
	private wide = false;
	private queued = false;
	/** Whether the overlay was on screen last paint, so it only animates in once. */
	private detailWasOpen = false;

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
			composing: false,
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

		// Repaint on width change so the layout can switch between one and two
		// panes without the user reopening anything.
		this.observer = new ResizeObserver(() => this.onResize());
		this.observer.observe(this.contentEl);

		// Escape closes the overlay before Obsidian gets the key.
		this.scope = new Scope(this.app.scope);
		this.scope.register([], "Escape", () => {
			if (!this.state.selectedTask) return true;
			this.closeDetail();
			return false;
		});

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

	private closeDetail(): void {
		this.state.selectedTask = null;
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
				this.state.composing = false;
				if (sel.kind === "list") {
					this.plugin.settings.lastList = sel.path;
					void this.plugin.saveSettings();
				}
				this.state.pane = "tasks";
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

			sortKey: () => {
				const sel = this.state.selection;
				if (sel.kind !== "list") return "custom";
				return (
					this.plugin.settings.sortByList[sel.path] ??
					this.plugin.store.getList(sel.path)?.config.sort ??
					this.plugin.settings.defaultSort
				);
			},

			setSortKey: (key: SortKey) => {
				const sel = this.state.selection;
				if (sel.kind !== "list") return;
				// Stored in settings, never written to the file — changing the sort
				// must not touch a single byte of the user's markdown.
				this.plugin.settings.sortByList[sel.path] = key;
				void this.plugin.saveSettings();
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
		const scrollTops: number[] = [];
		this.contentEl
			.findAll(".lists-scroll, .lists-nav-scroll")
			.forEach((el) => scrollTops.push(el.scrollTop));

		// Keep focus and caret if the user was typing.
		const active = document.activeElement as HTMLElement | null;
		const focusCls =
			active && this.contentEl.contains(active)
				? Array.from(active.classList).find((c) => c.startsWith("lists-"))
				: undefined;
		const caret =
			active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
				? active.selectionStart
				: null;
		const typed =
			active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
				? active.value
				: null;

		this.contentEl.empty();
		this.contentEl.toggleClass("is-wide", this.wide);
		this.contentEl.toggleClass("is-narrow", !this.wide);

		const ctx = this.buildContext();
		const shell = this.contentEl.createDiv({ cls: "lists-shell" });

		/* --- base layer: browsing lists, then a list --- */
		if (this.wide) {
			renderListsPane(shell, ctx);
			renderTasksPane(shell, ctx);
		} else if (this.state.pane === "nav") {
			renderListsPane(shell, ctx);
		} else {
			renderTasksPane(shell, ctx);
		}

		/* --- overlay layer: the detail panel, always floating --- */
		const showDetail = !!this.state.selectedTask;
		if (showDetail) {
			const backdrop = shell.createDiv({ cls: "lists-backdrop" });
			backdrop.addEventListener("click", () => this.closeDetail());

			const overlay = shell.createDiv({ cls: "lists-overlay" });
			renderDetailPane(overlay, ctx);

			if (this.detailWasOpen) {
				// Already on screen — show it in place, do not replay the animation.
				overlay.addClass("is-open");
				backdrop.addClass("is-open");
			} else {
				window.requestAnimationFrame(() => {
					overlay.addClass("is-open");
					backdrop.addClass("is-open");
				});
			}
		}
		this.detailWasOpen = showDetail;

		/* --- restore scroll and focus --- */
		this.contentEl
			.findAll(".lists-scroll, .lists-nav-scroll")
			.forEach((el, i) => {
				if (scrollTops[i]) el.scrollTop = scrollTops[i];
			});

		if (focusCls) {
			const el = this.contentEl.querySelector<HTMLElement>(`.${focusCls}`);
			if (el) {
				el.focus();
				if (
					(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
					typed !== null
				) {
					el.value = typed;
					if (caret !== null) el.setSelectionRange(caret, caret);
				}
			}
		}
	}
}
