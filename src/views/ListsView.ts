import { ItemView, Scope, ViewStateResult, WorkspaceLeaf } from "obsidian";
import type ListsPlugin from "../main";
import {
	PaneName,
	Selection,
	ViewContext,
	ViewState,
	sameSelection,
} from "./context";
import { renderListsPane } from "./panes/ListsPane";
import { renderTasksPane } from "./panes/TasksPane";
import { keyboardOverlap } from "./keyboard";
import { isTextEntry } from "./focus";
import { resetIfScrolled, unscrollableAncestors } from "./pinScroll";
import { ListColor, Task, ViewMode, normalizeViewMode } from "../model/types";
import { SortKey, orderLists } from "../model/sort";
import {
	RenderScope,
	decodeSelection,
	decodeTaskRef,
	encodeSelection,
	encodeTaskRef,
	selectionKey,
	selectionTitle,
	widerScope,
} from "./viewState";

export type { RenderScope };

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
	private queuedScope: RenderScope = "all";
	/**
	 * The containers kept alive between paints. Rebuilding only the pane that
	 * changed is what stops the view flashing on every edit — see `paint`.
	 */
	private shellEl: HTMLElement | null = null;
	private navEl: HTMLElement | null = null;
	private tasksEl: HTMLElement | null = null;
	/** Layout shape of the last paint. A change here forces a full rebuild. */
	private lastShape = "";
	private deferred = false;
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
			draft: {},
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
	 * True when this instance is purely a picker: the sidebar, with lists set to
	 * open in the main area.
	 *
	 * Without this a wide sidebar would render the task list beside the picker
	 * *and* open a tab showing the same thing. Picking a side and holding it is
	 * what makes the pane read as a navigator.
	 */
	private pickerOnly(): boolean {
		return this.plugin.settings.openListsInTab && !this.inMainWorkspace();
	}

	/**
	 * True when this instance is purely a list: a main-area tab, with the sidebar
	 * acting as the picker.
	 *
	 * The two halves of the same decision. Once the sidebar owns list-picking, a
	 * tab repeating the picker down its left edge is showing the user the same
	 * control twice and eating the width the tasks were opened to get.
	 */
	private listOnly(): boolean {
		return this.plugin.settings.openListsInTab && this.inMainWorkspace();
	}


	/**
	 * In a workspace tab this is the tab's title, so it names the list. In a
	 * sidebar it is the pane name — and on mobile it is a real text label in the
	 * drawer's tab list, not just a tooltip — so there it stays generic.
	 */
	getDisplayText(): string {
		if (!this.inMainWorkspace()) return "List Vibes";
		/*
		 * From the path, not from the store.
		 *
		 * A list's name *is* its filename, so the path is the authority and it is
		 * never out of date. The store is a cache of parsed files rebuilt from
		 * vault events, so between a rename landing and the reload finishing it
		 * can answer with the old name or with nothing — and this is read by
		 * Obsidian to label a tab, where a stale answer sits there disagreeing
		 * with the title inside the view until something else forces a redraw.
		 */
		return selectionTitle(this.state.selection);
	}

	getIcon(): string {
		return "list-todo";
	}

	/** True if this view is currently showing the list at `path`. */
	showsList(path: string): boolean {
		const sel = this.state.selection;
		return sel.kind === "list" && sel.path === path;
	}

	/**
	 * Move this view to another selection from the outside — used when a list is
	 * renamed elsewhere and this view was showing it. Repaints and, in a tab,
	 * refreshes the header so the name follows the file.
	 */
	async retarget(sel: Selection): Promise<void> {
		this.state.selection = sel;
		this.state.selectedTask = null;
		this.render();
		if (this.inMainWorkspace()) await this.persistState();
	}

	async onOpen(): Promise<void> {
		// Navigable only as a workspace tab, so it joins back/forward history
		// there. It must stay false in a sidebar: a navigable sidebar leaf is a
		// valid target for opening files, and clicking a note in the explorer
		// would replace the List Vibes pane with that note. Placement is only known
		// once the leaf is attached, so this cannot be set in the constructor.
		this.navigation = this.inMainWorkspace();

		this.contentEl.addClass("lv-root");
		// A file changing alters what the panes show, never the layout's shape,
		// so this repaints their contents and leaves the tree standing.
		this.unsubscribe = this.plugin.store.onChange(() => this.render("tasks"));

		// Repaint on width change so the layout can switch between one and two
		// panes without the user reopening anything.
		this.observer = new ResizeObserver(() => this.onResize());
		this.observer.observe(this.contentEl);

		// Escape clears the selection before Obsidian gets the key. It no longer
		// closes anything — the detail is a panel of Obsidian's, with its own
		// collapse — but a highlighted row with nothing behind it is a lie.
		this.scope = new Scope(this.app.scope);
		this.scope.register([], "Escape", () => {
			if (!this.state.selectedTask) return true;
			this.state.selectedTask = null;
			this.render("tasks");
			return false;
		});

		/*
		 * Measure the keyboard, and do exactly one thing with the answer:
		 * reserve room at the end of the scroller, as Obsidian does for its own.
		 *
		 * Everything else that used to be done with it is gone. The whole app
		 * slides upward on this platform when the keyboard rises — the editor
		 * included — so it is not this view's to correct, and correcting it was
		 * what kept breaking the view.
		 */
		this.trackKeyboard();
		this.pinAncestors();

		// A held-back repaint runs the moment the field is done with.
		this.registerDomEvent(this.contentEl, "focusout", () =>
			window.setTimeout(() => this.flushDeferred(), 0)
		);

		this.render();

		/*
		 * Name the tab, once.
		 *
		 * Obsidian reads getDisplayText() while the view is being constructed,
		 * and that answer depends on where the leaf ended up — which is not
		 * reliably known that early, because `leaf.getRoot()` only becomes the
		 * root split once the leaf is actually attached. Read too soon, a tab
		 * gets the sidebar's generic name and keeps it. By onOpen the placement
		 * is settled, so this asks Obsidian to read it again.
		 */
		if (this.inMainWorkspace()) void this.persistState();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.observer?.disconnect();
		this.observer = null;
	}

	/** Persisted by Obsidian per leaf, so every tab keeps its own list. */
	getState(): Record<string, unknown> {
		return {
			...(encodeSelection(this.state.selection) as Record<string, unknown>),
			...encodeTaskRef(this.state.selectedTask),
		};
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		// A leaf can be dragged between the sidebar and the main area.
		this.navigation = this.inMainWorkspace();

		const sel = decodeSelection(state);
		const task = decodeTaskRef(state);
		const movedList = !!sel && !sameSelection(sel, this.state.selection);
		const opening = !!task && !this.state.selectedTask;

		if (sel) {
			this.state.selection = sel;
			if (movedList) {
				this.state.composing = false;
				// Opening a list in a tab starts you in the list, not the picker.
				this.state.pane = "tasks";
			}
		}

		/*
		 * The detail panel follows the state rather than only the view's own
		 * memory, which is what makes back close it.
		 *
		 * On a narrow pane the panel and the list are the same screen, so the
		 * pane has to move with it — otherwise back would close the panel and
		 * leave you looking at a list you had already navigated away from.
		 */
		this.state.selectedTask = task;
		if (!this.wide) this.state.pane = task ? "detail" : "tasks";

		/*
		 * Only a real move earns a history entry.
		 *
		 * `result.history = true` asks Obsidian to remember the state we are
		 * leaving. Changing list and opening a task are both places you would
		 * expect back to return from. *Closing* a task is not — recording that
		 * would make back re-open the panel you had just dismissed — and neither
		 * is the round trip `persistState` makes to refresh the tab's title.
		 */
		result.history = movedList || opening;
		this.render();

		/*
		 * A tab retargeted from outside has to be told to reread its own name.
		 *
		 * There are two ways the list in a tab changes. Picking inside it goes
		 * through `select`, which persists a state the leaf does not have yet, and
		 * the header follows. Being retargeted — the sidebar is a picker, so
		 * choosing a list there reuses an open tab through `setViewState` —
		 * arrives *here*, where the leaf already holds this exact state. Persisting
		 * it again is a no-op, which is why doing that left the new list showing
		 * under the previous list's name.
		 *
		 * `updateHeader` is what asks a leaf to reread `getDisplayText`. It is real
		 * but absent from the public typings, so it is called only if it is there
		 * — a wrong tab title is worth fixing and not worth throwing for.
		 */
		if (movedList && this.inMainWorkspace()) {
			const leaf = this.leaf as WorkspaceLeaf & { updateHeader?: () => void };
			leaf.updateHeader?.();
		}
	}

	onResize(): void {
		// Only one breakpoint left. The pin one went with the overlay: the
		// detail is a panel Obsidian sizes now, not a column this view makes room
		// for.
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

	private buildContext(): ViewContext {
		return {
			app: this.app,
			store: this.plugin.store,
			mutator: this.plugin.mutator,
			settings: this.plugin.settings,
			state: this.state,
			wide: this.wide,
			listOnly: this.listOnly(),
			showPicker: () => void this.plugin.activateView(),
			render: (scope?: RenderScope) => this.render(scope ?? "all"),
			save: () => this.plugin.saveSettings(),

			select: (sel: Selection) => {
				this.state.selection = sel;
				this.state.selectedTask = null;
				this.state.composing = false;
				if (sel.kind === "list") {
					this.plugin.settings.lastList = sel.path;
					void this.plugin.saveSettings();
				}

				/*
				 * In the sidebar, picking a list opens it in the main area and the
				 * sidebar stays the picker — the same division of labour the file
				 * explorer has, and what makes the pane usable as a navigator
				 * rather than something you have to keep backing out of.
				 *
				 * The row is still marked selected here, so the picker shows where
				 * you are, and only the picker repaints.
				 */
				if (this.pickerOnly()) {
					// Move the highlight in place rather than repainting. A repaint
					// here would destroy the row under the pointer, which among other
					// things means a double-click to rename never survives its own
					// first click.
					this.markSelected();
					void this.plugin.openSelection(sel);
					return;
				}

				this.state.pane = "tasks";
				this.render();
				// In a workspace tab the header shows the list name, so the tab has
				// to be told the state changed. setViewState is the public way to do
				// that; it re-enters setState harmlessly.
				if (this.inMainWorkspace()) void this.persistState();
			},

			/*
			 * Selecting is now two things: mark the row, and show it on the right.
			 *
			 * The selection is still kept here because the row it belongs to has
			 * to look selected, and that is this view's business. What has gone
			 * is the panel: no state to push into leaf history, because there is
			 * no overlay for the back button to close.
			 */
			selectTask: (task: Task | null) => {
				this.state.selectedTask = task
					? { filePath: task.filePath, line: task.line }
					: null;
				this.state.openAction = null;
				this.render("tasks");
				void this.plugin.showTaskDetail(task);
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
				this.render("tasks");
			},

			viewMode: () => {
				const sel = this.state.selection;
				if (sel.kind !== "list") return "list";
				// Normalised on the way out as well as on load: settings written by
				// an older version say "cards", and so may a list's frontmatter.
				return (
					normalizeViewMode(this.plugin.settings.viewByList[sel.path]) ??
					this.plugin.store.getList(sel.path)?.config.view ??
					normalizeViewMode(this.plugin.settings.defaultView) ??
					"list"
				);
			},

			defaultViewMode: () =>
				normalizeViewMode(this.plugin.settings.defaultView) ?? "list",

			setDefaultViewMode: (mode: ViewMode) => {
				this.plugin.settings.defaultView = mode;
				void this.plugin.saveSettings();
				this.render("tasks");
			},

			orderedLists: () => {
				const lists = this.plugin.store.getLists();
				const order = orderLists(
					lists.map((l) => l.path),
					this.plugin.settings.listOrder
				);
				const byPath = new Map(lists.map((l) => [l.path, l]));
				return order.flatMap((p) => byPath.get(p) ?? []);
			},

			reorderLists: (paths: string[]) => {
				this.plugin.settings.listOrder = paths;
				void this.plugin.saveSettings();
				// The picker lives outside the task pane, so this is the whole tree.
				this.render("all");
			},

			sectionCollapsed: (path: string, name: string) =>
				(this.plugin.settings.collapsedSections[path] ?? []).includes(name),

			toggleSection: (path: string, name: string) => {
				const folded = this.plugin.settings.collapsedSections[path] ?? [];
				const next = folded.includes(name)
					? folded.filter((n) => n !== name)
					: [...folded, name];
				if (next.length) this.plugin.settings.collapsedSections[path] = next;
				else delete this.plugin.settings.collapsedSections[path];
				void this.plugin.saveSettings();
				this.render("tasks");
			},

			setViewMode: (mode: ViewMode) => {
				const sel = this.state.selection;
				if (sel.kind !== "list") return;
				this.plugin.settings.viewByList[sel.path] = mode;
				void this.plugin.saveSettings();
				// Also record it on the list, so the choice travels with the file.
				void this.plugin.mutator.setListConfig(sel.path, "view", mode);
				this.render("tasks");
			},

			setColor: (path: string, color: ListColor | null) => {
				void this.plugin.mutator.setListConfig(path, "color", color);
			},

			promote: (task: Task) => {
				void this.plugin.promote(task);
			},


			setIcon: (path: string, icon: string | null) => {
				// Frontmatter, not the filename: renaming a file to change its icon
				// would rewrite every link pointing at it.
				void this.plugin.mutator.setListConfig(path, "icon", icon);
			},

			deleteList: (path: string) => {
				// Whatever it was showing is gone, so the view falls back to the
				// picker rather than to a list that is not there any more.
				if (
					this.state.selection.kind === "list" &&
					this.state.selection.path === path
				) {
					this.state.selection = { kind: "smart", view: "all" };
					this.state.selectedTask = null;
				}
				void this.plugin.mutator.deleteList(path);
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
					this.render("tasks");
				});
			},
		};
	}

	/**
	 * True while the user is typing into a field inside this view.
	 *
	 * Deliberately asks the document rather than trusting `state.composing`: the
	 * add box, the note field and an inline rename are all live text, and any of
	 * them being replaced mid-keystroke is the same bug.
	 */
	private typing(): boolean {
		const el = document.activeElement;
		if (!el || !this.contentEl.contains(el)) return false;
		return isTextEntry(el);
	}

	/**
	 * Keep `--lv-keyboard-height` on the view equal to however much of it the
	 * soft keyboard is covering.
	 *
	 * The visual viewport is the part of the page actually on screen. When the
	 * keyboard opens it shrinks, or slides up leaving an offset, depending on
	 * the platform — so the covered height is what the layout viewport has that
	 * the visual one does not, less however far it has scrolled away.
	 */
	private trackKeyboard(): void {
		const win = this.contentEl.win;
		const vv = win.visualViewport;

		const measure = () => {
			/*
			 * Obsidian's own value first. Its native layer reads the platform's
			 * IME inset rather than inferring one, and Obsidian's whole mobile
			 * layout is built on this variable — `.app-container` is capped at
			 * `calc(100vh - var(--keyboard-height))`, the toolbar and navbar are
			 * positioned from it, and Obsidian's own first-party Importer plugin
			 * consumes it. Undocumented, so it carries a fallback.
			 */
			const native =
				parseFloat(
					win.getComputedStyle(win.document.documentElement).getPropertyValue(
						"--keyboard-height"
					)
				) || 0;

			/*
			 * The visual viewport second. It reports on iOS, but on Android the
			 * webview is not resized when the keyboard opens, so it frequently
			 * reports nothing at all — which is why this is one input rather than
			 * the only one. Small differences are browser chrome, not a keyboard.
			 */
			const visual = vv
				? Math.max(0, Math.round(win.innerHeight - vv.height - vv.offsetTop))
				: 0;

			/*
			 * Which of the two to believe, and how far, is arithmetic with a
			 * history of being wrong, so it lives in `keyboardOverlap` where it
			 * can be tested against the readings a device actually produces.
			 *
			 * What the answer is used for is narrow on purpose. Nothing is
			 * lifted by it — Obsidian has already shortened the container — but
			 * a scroller reserves room at its end so a field can be scrolled
			 * clear of the keyboard, exactly as Obsidian's own settings scroller
			 * does.
			 */
			const keyboard = keyboardOverlap({
				native,
				visual,
				viewHeight: this.contentEl.clientHeight || win.innerHeight,
			});

			this.contentEl.style.setProperty("--lv-keyboard-height", `${keyboard}px`);
			this.contentEl.toggleClass("is-keyboard-open", keyboard > 0);


			// The field may still be scrolled out of its own list. Only that
			// scroller is moved: `scrollIntoView` walks every ancestor and, with
			// ours unable to scroll, ends up asking the page to move — which is
			// the fault this exists to avoid.
			win.requestAnimationFrame(() => {
				const active = this.contentEl.doc.activeElement;
				if (active instanceof HTMLElement && this.contentEl.contains(active)) {
					this.revealInScroller(active);
				}
			});
		};

		if (vv) {
			this.registerDomEvent(vv as unknown as Window, "resize", measure);
			this.registerDomEvent(vv as unknown as Window, "scroll", measure);
		}

		/*
		 * Obsidian dispatches these on window on both platforms, and on Android
		 * they are often the only signal — neither innerHeight nor visualViewport
		 * changes. Deferred by a tick because Obsidian writes --keyboard-height in
		 * response to the same event, and the order between the two handlers is
		 * not guaranteed.
		 */
		for (const ev of [
			"keyboardWillShow",
			"keyboardDidShow",
			"keyboardWillHide",
			"keyboardDidHide",
		]) {
			this.registerDomEvent(win, ev as "resize", () => win.setTimeout(measure, 0));
		}

		// Focus is the last resort: the keyboard can open with no viewport event.
		this.registerDomEvent(this.contentEl, "focusin", measure);
		this.registerDomEvent(this.contentEl, "focusout", () =>
			win.setTimeout(measure, 80)
		);
		this.registerDomEvent(win, "resize", measure);
		this.registerDomEvent(win, "orientationchange", measure);

		measure();
	}

	/**
	 * Bring a focused field into view by moving its own scroller and nothing else.
	 *
	 * `scrollIntoView` would be shorter, and it is what was here before. The
	 * trouble is that it walks every ancestor looking for something that can
	 * move, and ours deliberately cannot — so it keeps walking, reaches the page,
	 * and scrolls that instead. On a phone that means the whole app slides up and
	 * leaves blank space, which is exactly the symptom being chased.
	 */
	private revealInScroller(active: HTMLElement): void {
		const scroller = active.closest<HTMLElement>(".lv-scroll, .lv-nav-scroll");
		// A field outside every scroller — the add box, say — cannot be revealed
		// this way at all. Making the view fit the screen is what saves that one.
		if (!scroller || !this.contentEl.contains(scroller)) return;

		const field = active.getBoundingClientRect();
		const box = scroller.getBoundingClientRect();
		const margin = 8;

		if (field.top < box.top) {
			scroller.scrollTop -= box.top - field.top + margin;
		} else if (field.bottom > box.bottom) {
			scroller.scrollTop += field.bottom - box.bottom + margin;
		}
	}

	/**
	 * Stop the browser scrolling this view out of sight to reveal a focused field.
	 *
	 * An `overflow: hidden` box is still a scroll container — it merely has no
	 * scrollbar. So when the keyboard covers a focused input the browser walks up
	 * the ancestors looking for something that can be scrolled to reveal it, and
	 * an `overflow: hidden` ancestor answers yes. Everything inside it then slides
	 * up together, and because there is no scrollbar nobody can bring it back
	 * until the keyboard closes and the overflow disappears.
	 *
	 * Which ancestor answers decides how much vanishes. `.view-content` takes the
	 * view with it; `.app-container` takes Obsidian's own header and navigation
	 * bar too, which is the whole screen going blank. Guarding two named boxes
	 * left every other link in that chain unguarded, so this walks the chain.
	 *
	 * Pinning is safe precisely because these boxes have no scrollbar: a scroll
	 * offset the user cannot see and cannot undo is never something they asked
	 * for. It is the same guard core runs on the document root, one level down.
	 */
	private pinAncestors(): void {
		for (const el of unscrollableAncestors(this.contentEl, this.contentEl.win)) {
			this.registerDomEvent(el, "scroll", () => {
				const was = Math.round(el.scrollTop);
				if (!resetIfScrolled(el)) return;
				const name = String(el.className || el.tagName).split(" ")[0];
				console.debug("[List Vibes] put back a scrolled ancestor:", name, was);
			});
		}
	}

	/** Run a repaint that was held back while the user was typing. */
	private flushDeferred(): void {
		if (!this.deferred || this.typing()) return;
		this.deferred = false;
		this.render(this.queuedScope);
	}

	/** Move the picker's highlight to the current selection, without a repaint. */
	private markSelected(): void {
		const key = selectionKey(this.state.selection);
		this.contentEl
			.findAll(".lv-nav-row[data-lv-sel]")
			.forEach((el) => el.toggleClass("is-selected", el.dataset.lvSel === key));
	}

	/** Coalesce repaints so a burst of file events costs one pass. */
	render(scope: RenderScope = "all"): void {
		this.queuedScope = this.queued
			? widerScope(this.queuedScope, scope)
			: scope;

		/*
		 * Never repaint out from under someone who is typing.
		 *
		 * A repaint replaces the focused field, and on Android that breaks the
		 * IME composition mid-word. A file change arriving while the user types
		 * can wait: the list behind the add box being one frame stale is
		 * invisible, whereas losing a half-typed word is not. The deferred
		 * repaint runs as soon as the field gives up focus.
		 */
		if (this.typing()) {
			this.deferred = true;
			return;
		}

		if (this.queued) return;
		this.queued = true;
		window.requestAnimationFrame(() => {
			this.queued = false;
			const s = this.queuedScope;
			this.queuedScope = "all";
			this.paint(s);
		});
	}

	/**
	 * The layout shape, as opposed to its contents. Two paints with the same
	 * shape can reuse the same containers; a change means the tree itself is
	 * different and has to be rebuilt.
	 */
	private shape(): string {
		if (this.pickerOnly()) return "picker";
		if (this.listOnly()) return "list";
		return [
			this.wide ? "wide" : "narrow",
			this.wide ? "both" : this.state.pane,
			this.state.selectedTask ? "detail" : "nodetail",
		].join("|");
	}

	/**
	 * Forget a selected task that is no longer in its file.
	 *
	 * The detail panel has no empty state — a task is what it is for — so when
	 * the task it was told to show cannot be found it renders as a blank panel
	 * standing open over the list. Reordering used to produce exactly that: the
	 * drop rewrote the file, every line below moved, and the panel was pointed at
	 * a line that had become something else.
	 *
	 * The click that opened it is suppressed now, so this is the second guard
	 * rather than the fix. It is worth having anyway, because a file can change
	 * underneath a selection for reasons that have nothing to do with this view —
	 * an edit in a pane next door, a sync landing — and a panel that closes is
	 * always better than one that goes blank.
	 *
	 * Only when the file is actually loaded. On a cold start the store is empty
	 * for a moment, and pruning then would throw away the selection restored from
	 * the last session before there was anything to check it against.
	 */
	private pruneSelection(): void {
		const ref = this.state.selectedTask;
		if (!ref) return;
		if (!this.plugin.store.getList(ref.filePath)) return;
		if (!this.plugin.store.findTask(ref.filePath, ref.line)) {
			this.state.selectedTask = null;
		}
	}

	private paint(scope: RenderScope = "all"): void {
		this.wide = this.contentEl.clientWidth >= WIDE_BREAKPOINT;
		this.pruneSelection();

		const shape = this.shape();
		const reuse = scope !== "all" && shape === this.lastShape && !!this.shellEl;

		if (reuse) {
			this.repaintPanes(scope);
			return;
		}

		this.rebuild(shape);
	}

	/**
	 * Refill the panes this repaint names, leaving the rest of the tree — and
	 * therefore its scroll position, its focus and the overlay's own transition
	 * state — exactly as it was.
	 */
	private repaintPanes(scope: RenderScope): void {
		const ctx = this.buildContext();
		// A scoped repaint replaces panes wholesale too, so it has to put the
		// caret back — otherwise committing a step drops focus and the next one
		// cannot be typed without tapping the field again.
		const focus = this.captureFocus();

		if (scope !== "detail") {
			if (this.navEl) {
				this.navEl = swapPane(this.navEl, (p) => renderListsPane(p, ctx));
			}
			if (this.tasksEl) {
				this.tasksEl = swapPane(this.tasksEl, (p) => renderTasksPane(p, ctx));
			}
		}

		this.restoreFocus(focus);
	}

	/**
	 * Remember which field had the caret, so a repaint can hand it back.
	 *
	 * Identified by its own class rather than by node, because the node is about
	 * to be destroyed. That means the *first* element with that class wins, which
	 * is right here — each of these fields is unique within a pane.
	 */
	private captureFocus(): { cls: string; caret: number | null; value: string | null } | null {
		const el = document.activeElement as HTMLElement | null;
		if (!el || !this.contentEl.contains(el)) return null;
		const cls = Array.from(el.classList).find((c) => c.startsWith("lv-"));
		if (!cls) return null;
		const field =
			el.instanceOf(HTMLInputElement) || el.instanceOf(HTMLTextAreaElement) ? el : null;
		return { cls, caret: field ? field.selectionStart : null, value: field ? field.value : null };
	}

	private restoreFocus(saved: ReturnType<ListsView["captureFocus"]>): void {
		if (!saved) return;
		const el = this.contentEl.querySelector<HTMLElement>(`.${saved.cls}`);
		if (!el) return;
		el.focus();
		if (
			(el.instanceOf(HTMLInputElement) || el.instanceOf(HTMLTextAreaElement)) &&
			saved.value !== null
		) {
			el.value = saved.value;
			if (saved.caret !== null) el.setSelectionRange(saved.caret, saved.caret);
		}
	}

	/** Full teardown. Only for a genuine change of layout shape. */
	private rebuild(shape: string): void {
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
		this.shellEl = shell;
		this.navEl = null;
		this.tasksEl = null;

		/* --- base layer: browsing lists, then a list --- */
		const added = (fn: () => void): HTMLElement => {
			fn();
			return shell.lastElementChild as HTMLElement;
		};
		if (this.pickerOnly()) {
			this.navEl = added(() => renderListsPane(shell, ctx));
		} else if (this.listOnly()) {
			this.tasksEl = added(() => renderTasksPane(shell, ctx));
		} else if (this.wide) {
			this.navEl = added(() => renderListsPane(shell, ctx));
			this.tasksEl = added(() => renderTasksPane(shell, ctx));
		} else if (this.state.pane === "nav") {
			this.navEl = added(() => renderListsPane(shell, ctx));
		} else {
			this.tasksEl = added(() => renderTasksPane(shell, ctx));
		}

		/*
		 * No detail layer here any more.
		 *
		 * It was an overlay sliding over the list, which meant owning a
		 * backdrop, a transform, a swipe-to-dismiss gesture and an Android
		 * back-button handler — all of which Obsidian's right panel provides
		 * for every view docked in it. Selecting a task now opens that panel
		 * instead; see `ListsPlugin.showTaskDetail`.
		 */
		this.lastShape = shape;

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
					(el.instanceOf(HTMLInputElement) || el.instanceOf(HTMLTextAreaElement)) &&
					typed !== null
				) {
					el.value = typed;
					if (caret !== null) el.setSelectionRange(caret, caret);
				}
			}
		}
	}
}

/**
 * Rebuild one pane in place.
 *
 * The pane is built detached and then swapped for the old one, rather than the
 * old one being emptied and refilled: a pane element carries state of its own —
 * the list's colour class, for one — and refilling it would let that accumulate
 * across lists. Its scroll offset is carried over by hand, since that is the one
 * piece of the old element worth keeping.
 */
function swapPane(el: HTMLElement, render: (parent: HTMLElement) => void): HTMLElement {
	const scrolled = el.querySelector<HTMLElement>(".lv-scroll, .lv-nav-scroll");
	const keep = scrolled ? scrolled.scrollTop : 0;

	const holder = createDiv();
	render(holder);
	const next = holder.firstElementChild as HTMLElement | null;
	if (!next) return el;

	el.replaceWith(next);
	if (keep) {
		const sc = next.querySelector<HTMLElement>(".lv-scroll, .lv-nav-scroll");
		if (sc) sc.scrollTop = keep;
	}
	return next;
}
