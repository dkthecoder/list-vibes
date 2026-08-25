import { App, FuzzySuggestModal, Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, ListsSettingTab, ListsSettings } from "./settings";
import { ListStore, todayISO } from "./model/store";
import { TaskList } from "./model/types";
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

		this.addRibbonIcon("list-todo", "Lists", () => void this.activateView());

		this.addSettingTab(new ListsSettingTab(this.app, this));
		this.registerCommands();
		this.registerVaultEvents();
		this.registerFileMenu();

		// Wait for the vault index before the first read, otherwise the folder
		// may not be populated yet on a cold start.
		this.app.workspace.onLayoutReady(() => void this.store.reloadAll());
	}

	onunload(): void {
		// Leaves are deliberately not detached here: Obsidian restores them, and
		// detaching on unload is a documented review failure.
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
			name: "Open lists",
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
