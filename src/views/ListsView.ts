import { ItemView, Scope, ViewStateResult, WorkspaceLeaf } from "obsidian";
import type ListsPlugin from "../main";
import { PaneName, Selection, ViewContext, ViewState } from "./context";
import { renderListsPane } from "./panes/ListsPane";
import { renderTasksPane } from "./panes/TasksPane";
import { renderDetailPane } from "./panes/DetailPane";
import { ListColor, Task, ViewMode } from "../model/types";
import { SortKey } from "../model/sort";
import { decodeSelection, encodeSelection, selectionTitle } from "./viewState";

export const VIEW_TYPE_LISTS = "list-vibes-view";

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
	/** Guards the setViewState round trip from re-entering itself. */
	private persisting = false;

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
			openAction: null,
		};
	}

	getViewType(): string {
		return VIEW_TYPE_LISTS;
	}

	/** True when this view is a tab in the main workspace rather than a sidebar. */
	private inMainWorkspace(): boolean {
		return this.leaf.getRoot() === this.app.workspace.rootSplit;
	}

	/**
	 * In a workspace tab this is the tab's title, so it names the list. In a
	 * sidebar it is the pane name — and on mobile it is a real text label in the
	 * drawer's tab list, not just a tooltip — so there it stays generic.
	 */
	getDisplayText(): string {
		if (!this.inMainWorkspace()) return "List Vibes";
		const sel = this.state.selection;
		const name =
			sel.kind === "list" ? this.plugin.store.getList(sel.path)?.name : undefined;
		return selectionTitle(sel, name);
	}

	getIcon(): string {
		return "list-todo";
	}

	async onOpen(): Promise<void> {
		// Navigable only as a workspace tab, so it joins back/forward history
		// there. It must stay false in a sidebar: a navigable sidebar leaf is a
		// valid target for opening files, and clicking a note in the explorer
		// would replace the List Vibes pane with that note. Placement is only known
		// once the leaf is attached, so this cannot be set in the constructor.
		this.navigation = this.inMainWorkspace();

		this.contentEl.addClass("lv-root");
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

	/** Persisted by Obsidian per leaf, so every tab keeps its own list. */
	getState(): Record<string, unknown> {
		return encodeSelection(this.state.selection) as Record<string, unknown>;
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		// A leaf can be dragged between the sidebar and the main area.
		this.navigation = this.inMainWorkspace();

		const sel = decodeSelection(state);
		if (sel) {
			this.state.selection = sel;
			this.state.selectedTask = null;
			this.state.composing = false;
			// Opening a list in a tab starts you in the list, not the picker.
			this.state.pane = "tasks";
		}
		result.history = true;
		this.render();
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

	/** Push the current selection back into the leaf so the tab title follows it. */
	private async persistState(): Promise<void> {
		if (this.persisting) return;
		this.persisting = true;
		try {
			await this.leaf.setViewState({
				type: VIEW_TYPE_LISTS,
				active: true,
				state: this.getState(),
			});
		} finally {
			this.persisting = false;
		}
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
				// In a workspace tab the header shows the list name, so the tab has
				// to be told the state changed. setViewState is the public way to do
				// that; it re-enters setState harmlessly.
				if (this.inMainWorkspace()) void this.persistState();
			},

			selectTask: (task: Task | null) => {
				this.state.selectedTask = task
					? { filePath: task.filePath, line: task.line }
					: null;
				this.state.openAction = null;
				this.render();
			},

			showPane: (pane: PaneName) => {
				this.state.pane = pane;
				this.render();
			},

			openInNewTab: (sel: Selection) => void this.plugin.openSelection(sel, true),

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

			viewMode: () => {
				const sel = this.state.selection;
				if (sel.kind !== "list") return "list";
				return (
					this.plugin.settings.viewByList[sel.path] ??
					this.plugin.store.getList(sel.path)?.config.view ??
					this.plugin.settings.defaultView
				);
			},

			setViewMode: (mode: ViewMode) => {
				const sel = this.state.selection;
				if (sel.kind !== "list") return;
				this.plugin.settings.viewByList[sel.path] = mode;
				void this.plugin.saveSettings();
				// Also record it on the list, so the choice travels with the file.
				void this.plugin.mutator.setListConfig(sel.path, "view", mode);
				this.render();
			},

			setColor: (path: string, color: ListColor | null) => {
				void this.plugin.mutator.setListConfig(path, "color", color);
			},

			renameList: (path: string, name: string) => {
				void this.plugin.mutator.renameList(path, name).then((next) => {
					if (!next) return;
					// Follow the list to its new path rather than losing the selection.
					const s = this.plugin.settings;
					if (s.sortByList[path]) {
						s.sortByList[next] = s.sortByList[path];
						delete s.sortByList[path];
					}
					if (s.viewByList[path]) {
						s.viewByList[next] = s.viewByList[path];
						delete s.viewByList[path];
					}
					if (s.lastList === path) s.lastList = next;
					void this.plugin.saveSettings();

					if (
						this.state.selection.kind === "list" &&
						this.state.selection.path === path
					) {
						this.state.selection = { kind: "list", path: next };
						if (this.inMainWorkspace()) void this.persistState();
					}
					this.render();
				});
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
			.findAll(".lv-scroll, .lv-nav-scroll")
			.forEach((el) => scrollTops.push(el.scrollTop));

		// Keep focus and caret if the user was typing.
		const active = document.activeElement as HTMLElement | null;
		const focusCls =
			active && this.contentEl.contains(active)
				? Array.from(active.classList).find((c) => c.startsWith("lv-"))
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
		const shell = this.contentEl.createDiv({ cls: "lv-shell" });

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
			const backdrop = shell.createDiv({ cls: "lv-backdrop" });
			backdrop.addEventListener("click", () => this.closeDetail());

			const overlay = shell.createDiv({ cls: "lv-overlay" });
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
			.findAll(".lv-scroll, .lv-nav-scroll")
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
