import {
	App,
	FuzzySuggestModal,
	Notice,
	Plugin,
	TAbstractFile,
	TFile,
	WorkspaceLeaf,
	WorkspaceParent,
	WorkspaceSplit,
	WorkspaceTabs,
} from "obsidian";
import { DEFAULT_SETTINGS, ListsSettingTab, ListsSettings } from "./settings";
import { ListStore, todayISO } from "./model/store";
import { TaskList, normalizeViewMode } from "./model/types";
import { Mutator } from "./model/mutate";
import { ListsView, VIEW_TYPE_LISTS } from "./views/ListsView";
import { PromptModal } from "./ui/PromptModal";
import { Selection } from "./views/context";
import { encodeSelection } from "./views/viewState";

export default class ListsPlugin extends Plugin {
	declare settings: ListsSettings;
	store!: ListStore;
	mutator!: Mutator;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.store = new ListStore(this.app, this.settings.folder);
		this.mutator = new Mutator(this.app, {
			dialect: () => this.settings.dialect,
			addDoneDate: () => this.settings.addDoneDate,
			addCreatedDate: () => this.settings.addCreatedDate,
		});

		this.registerView(VIEW_TYPE_LISTS, (leaf) => new ListsView(leaf, this));

		this.addRibbonIcon("list-todo", "List Vibes", () => void this.activateView());

		this.addSettingTab(new ListsSettingTab(this.app, this));
		this.registerCommands();
		this.registerVaultEvents();
		this.registerFileMenu();

		// Wait for the vault index before the first read, otherwise the folder
		// may not be populated yet on a cold start.
		this.app.workspace.onLayoutReady(() => {
			void this.store.reloadAll();
			if (this.settings.openOnStartup) void this.ensureInSidebar();
		});
	}

	onunload(): void {
		// Leaves are deliberately not detached here: Obsidian restores them, and
		// detaching on unload is a documented review failure.
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

		// The post-it wall was called "cards" before. Settings are ours, so unlike
		// a list's frontmatter they can be migrated in place; the reader still
		// accepts the old name because a file on disk may keep using it.
		this.settings.defaultView =
			normalizeViewMode(this.settings.defaultView) ?? "list";
		for (const [path, mode] of Object.entries(this.settings.viewByList)) {
			const next = normalizeViewMode(mode);
			if (next) this.settings.viewByList[path] = next;
			else delete this.settings.viewByList[path];
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Reparse everything and repaint, e.g. after a folder change. */
	refresh(): void {
		this.store.setFolder(this.settings.folder);
	}

	/** Repaint open views without rereading the vault. */
	refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_LISTS)) {
			(leaf.view as ListsView).render();
		}
	}

	/* ---------------------------------------------------------------- */

	private registerVaultEvents(): void {
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (this.store.isListFile(file)) void this.store.reloadFile(file);
			})
		);
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (this.store.isListFile(file)) void this.store.reloadFile(file);
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (file: TAbstractFile) => {
				this.store.removeFile(file.path);
			})
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				this.store.removeFile(oldPath);
				if (this.settings.lastList === oldPath) {
					this.settings.lastList = file.path;
					void this.saveSettings();
				}
				if (this.store.isListFile(file)) void this.store.reloadFile(file);
			})
		);
	}

	/** "Open as list" on any markdown file inside the lists folder. */
	private registerFileMenu(): void {
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFile) || !this.store.isListFile(file)) return;
				menu.addItem((i) =>
					i
						.setTitle("Open as list")
						.setIcon("list-todo")
						.onClick(() => void this.openSelection({ kind: "list", path: file.path }))
				);
			})
		);
	}

	private registerCommands(): void {
		this.addCommand({
			id: "open",
			name: "Open List Vibes",
			callback: () => void this.activateView(),
		});

		this.addCommand({
			id: "open-my-day",
			name: "Open My Day",
			callback: async () => {
				const view = await this.activateView();
				view?.reveal({ kind: "smart", view: "myday" });
			},
		});

		this.addCommand({
			id: "open-list-in-tab",
			name: "Open a list in a new tab",
			callback: () => this.pickList((path) => void this.openSelection({ kind: "list", path })),
		});

		this.addCommand({
			id: "quick-add",
			name: "Add a task",
			callback: () => this.quickAdd(),
		});

		this.addCommand({
			id: "quick-add-today",
			name: "Add a task to My Day",
			callback: () => this.quickAdd({ myDay: true, due: todayISO() }),
		});
	}

	/** Choose a list by name, for commands that need one. */
	private pickList(onPick: (path: string) => void): void {
		const lists = this.store.getLists();
		if (!lists.length) {
			new Notice(`No lists found in "${this.settings.folder}".`);
			return;
		}
		if (lists.length === 1) {
			onPick(lists[0].path);
			return;
		}
		new ListSuggestModal(this.app, lists, onPick).open();
	}

	/** Capture a task without opening the view first. */
	private quickAdd(meta: { myDay?: boolean; due?: string } = {}): void {
		const lists = this.store.getLists();
		if (!lists.length) {
			new Notice(`No lists found in "${this.settings.folder}".`);
			return;
		}
		const target =
			lists.find((l) => l.path === this.settings.lastList) ?? lists[0];

		new PromptModal(this.app, {
			title: `Add to ${target.name}`,
			placeholder: "What needs doing?",
			cta: "Add",
			onSubmit: async (value) => {
				if (!value.trim()) return;
				await this.mutator.addTask(target.path, value, meta);
				new Notice(`Added to ${target.name}`);
			},
		}).open();
	}

	/**
	 * Put the view in the sidebar so it sits alongside Files, Search and
	 * Bookmarks, without stealing focus from whatever the user had open.
	 */
	private async ensureInSidebar(): Promise<void> {
		if (this.app.workspace.getLeavesOfType(VIEW_TYPE_LISTS).length) return;
		try {
			if (this.settings.sidebarFirst) {
				const leaf = this.leafAtFrontOfSidebar();
				if (leaf) {
					await leaf.setViewState({ type: VIEW_TYPE_LISTS, active: false });
					return;
				}
			}
			await this.app.workspace.ensureSideLeaf(VIEW_TYPE_LISTS, this.settings.side, {
				active: false,
				reveal: false,
			});
		} catch {
			// A workspace layout that will not take the leaf is not worth a
			// notice on startup; the ribbon icon still opens it.
		}
	}

	/**
	 * Create a leaf at the front of the sidebar's tab strip, or null if that is
	 * not possible here.
	 *
	 * `getLeftLeaf` and `ensureSideLeaf` always append — Obsidian passes index -1
	 * internally and offers no way to change it — which is why every community
	 * plugin lands after Files, Search and Bookmarks. `createLeafInParent` is
	 * public, documented, and takes an index, and the tab strip is rebuilt from
	 * the parent's children on every layout change, so inserting at 0 puts the
	 * tab first and Obsidian persists that to workspace.json like any other
	 * layout change.
	 *
	 * The one wrinkle is a typings gap: the parameter is declared
	 * `WorkspaceSplit`, but a sidebar's leaves live in a `WorkspaceTabs`, which
	 * extends `WorkspaceParent` instead. Both share the `children` and
	 * `insertChild` implementation the method actually uses, so the cast is
	 * describing runtime reality rather than reaching past the public API.
	 */
	private leafAtFrontOfSidebar(): WorkspaceLeaf | null {
		const { workspace } = this.app;
		const root = this.settings.side === "left" ? workspace.leftSplit : workspace.rightSplit;
		if (!root) return null;

		let tabs: WorkspaceTabs | null = null;
		workspace.iterateAllLeaves((leaf) => {
			if (tabs) return;
			// Only leaves belonging to the sidebar we are targeting.
			for (let p = leaf.parent as WorkspaceParent | null; p; p = p.parent) {
				if (p !== root) continue;
				if (leaf.parent instanceof WorkspaceTabs) tabs = leaf.parent;
				return;
			}
		});
		// On mobile the sidebar is a WorkspaceMobileDrawer, whose tabs are a
		// vertical list rather than a strip; leave that to ensureSideLeaf.
		if (!tabs) return null;

		// createLeafInParent focuses the leaf it makes, which on startup would
		// take the user to an empty sidebar pane. Put focus back where it was.
		const previous = workspace.getMostRecentLeaf();
		const leaf = workspace.createLeafInParent(
			tabs as unknown as WorkspaceSplit,
			0
		);
		if (previous) workspace.setActiveLeaf(previous, { focus: false });
		return leaf;
	}

	/**
	 * Open a list as a tab in the main workspace.
	 *
	 * Each tab carries its own selection through the view's state, so several
	 * lists can be open side by side and each remembers its own after a restart.
	 */
	async openSelection(sel: Selection, newTab = true): Promise<void> {
		const leaf = this.app.workspace.getLeaf(newTab ? "tab" : false);
		await leaf.setViewState({
			type: VIEW_TYPE_LISTS,
			active: true,
			state: encodeSelection(sel),
		});
		await this.app.workspace.revealLeaf(leaf);
	}

	/**
	 * Open the view in the configured sidebar, or focus it if already open.
	 * `ensureSideLeaf` is used rather than `getLeftLeaf`, which returns null on
	 * mobile.
	 */
	async activateView(): Promise<ListsView | null> {
		const { workspace } = this.app;

		const existing = workspace.getLeavesOfType(VIEW_TYPE_LISTS);
		if (existing.length) {
			await workspace.revealLeaf(existing[0]);
			return existing[0].view as ListsView;
		}

		const leaf: WorkspaceLeaf = await workspace.ensureSideLeaf(
			VIEW_TYPE_LISTS,
			this.settings.side,
			{ reveal: true, active: true }
		);
		return (leaf?.view as ListsView) ?? null;
	}
}

/** Fuzzy picker over the lists in the folder. */
class ListSuggestModal extends FuzzySuggestModal<TaskList> {
	private lists: TaskList[];
	private onPick: (path: string) => void;

	constructor(app: App, lists: TaskList[], onPick: (path: string) => void) {
		super(app);
		this.lists = lists;
		this.onPick = onPick;
		this.setPlaceholder("Open which list?");
	}

	getItems(): TaskList[] {
		return this.lists;
	}

	getItemText(list: TaskList): string {
		return list.config.icon ? `${list.config.icon} ${list.name}` : list.name;
	}

	onChooseItem(list: TaskList): void {
		this.onPick(list.path);
	}
}
