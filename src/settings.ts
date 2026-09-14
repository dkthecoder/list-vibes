import { App, PluginSettingTab, Setting } from "obsidian";
import type ListsPlugin from "./main";
import { Dialect, ViewMode } from "./model/types";
import { SORT_OPTIONS, SortKey } from "./model/sort";

export interface ListsSettings {
	/** Vault-relative folder holding the list files. */
	folder: string;
	/** Which inline syntax to write. Both are always read. */
	dialect: Dialect;
	/** Render nested checkboxes as steps with a progress counter. */
	enableSubtasks: boolean;
	/**
	 * Which sidebar to open in. Mobile users cannot move a tab between sidebars
	 * themselves, so this has to be a setting rather than a default.
	 */
	side: "left" | "right";
	/** Default state of the Completed section. */
	showCompleted: "collapsed" | "expanded" | "hidden";
	/** Stamp a ✅ date when a task is completed. */
	addDoneDate: boolean;
	/** Stamp a ➕ date on newly created tasks. */
	addCreatedDate: boolean;
	/** Write a time alongside the completed and created dates. */
	stampTime: boolean;
	/**
	 * How importance is shown and edited.
	 * Both modes read and write the same priority field, so switching is free
	 * and never rewrites a file.
	 */
	importanceMode: "star" | "stars5";
	/** Sort applied to lists that have not been given their own. */
	defaultSort: SortKey;
	/** Per-list sort choice, keyed by file path. View-only, never written to the file. */
	sortByList: Record<string, SortKey>;
	/** Add the view to the sidebar automatically when Obsidian starts. */
	openOnStartup: boolean;
	/** Place it first in the sidebar's tab strip the first time it is created. */
	sidebarFirst: boolean;
	/**
	 * Folder that promoted tasks become notes in. Empty means the vault root.
	 * Kept apart from the lists folder so promoted notes are not themselves
	 * mistaken for lists.
	 */
	notesFolder: string;
	/** From the sidebar, open a picked list as a workspace tab. */
	openListsInTab: boolean;
	/**
	 * Keep the task detail panel as a fixed column rather than an overlay.
	 * Only honoured where there is room for it; a narrow pane always overlays.
	 */
	/**
	 * Tidy a list's name for the title above it — separators shown as spaces.
	 * Display only: the file keeps the name it has, and editing the title always
	 * edits the real one.
	 */
	prettyTitles: boolean;
	/** Layout a new list starts in, for lists whose file does not say. */
	defaultView: ViewMode;
	/** Shade alternate rows, for lists that have not chosen for themselves. */
	stripeRows: boolean;
	/** Throw confetti when a task is completed. Ignored under reduced motion. */
	confetti: boolean;
	/** Glint when a task is starred. Ignored under reduced motion. */
	starBurst: boolean;
	/** Per-list layout override, keyed by file path. */
	viewByList: Record<string, ViewMode>;
	/** Last opened list, restored on reopen. */
	lastList?: string;
}

export const DEFAULT_SETTINGS: ListsSettings = {
	folder: "lists",
	dialect: "emoji",
	enableSubtasks: true,
	side: "left",
	showCompleted: "collapsed",
	stripeRows: true,
	confetti: true,
	starBurst: true,
	addDoneDate: true,
	addCreatedDate: true,
	stampTime: true,
	importanceMode: "star",
	defaultSort: "custom",
	sortByList: {},
	prettyTitles: true,
	defaultView: "list",
	viewByList: {},
	openOnStartup: true,
	sidebarFirst: false,
	notesFolder: "tasks",
	openListsInTab: true,
};

export class ListsSettingTab extends PluginSettingTab {
	plugin: ListsPlugin;

	constructor(app: App, plugin: ListsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Lists folder")
			.setDesc(
				"Vault folder holding your list files. Each markdown file in it is one list. Avoid names starting with a dot, as Obsidian excludes those folders from the vault entirely."
			)
			.addText((t) =>
				t
					.setPlaceholder("lists")
					.setValue(this.plugin.settings.folder)
					.onChange(async (v) => {
						this.plugin.settings.folder = v.trim() || "lists";
						await this.plugin.saveSettings();
						this.plugin.refresh();
					})
			);

		new Setting(containerEl)
			.setName("Sidebar")
			.setDesc(
				"Which sidebar the list view opens in. On mobile a tab cannot be moved between sidebars after the fact, so pick before you settle in."
			)
			.addDropdown((d) =>
				d
					.addOption("left", "Left")
					.addOption("right", "Right")
					.setValue(this.plugin.settings.side)
					.onChange(async (v) => {
						this.plugin.settings.side = v as "left" | "right";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Show in the sidebar on startup")
			.setDesc(
				"Adds List Vibes to the sidebar alongside Files and Search when Obsidian opens, without taking focus."
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.openOnStartup).onChange(async (v) => {
					this.plugin.settings.openOnStartup = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Put it first in the sidebar")
			.setDesc(
				"Insert List Vibes ahead of Files, Search and Bookmarks instead of after them. This only applies when the pane is first created — once it is in your layout, its position is yours, and dragging it somewhere else sticks. Desktop only; the mobile drawer has no tab strip to reorder."
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.sidebarFirst).onChange(async (v) => {
					this.plugin.settings.sidebarFirst = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Open lists in a tab")
			.setDesc(
				"Picking a list in the sidebar opens it in the main area, leaving the sidebar as the picker — the way the file explorer works. One tab is reused as you click through lists; ⌘/Ctrl-click or middle-click opens an extra one, and pinning a tab keeps it on its own list. Turn this off to browse entirely inside the sidebar pane instead."
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.openListsInTab).onChange(async (v) => {
					this.plugin.settings.openListsInTab = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl).setName("Tasks").setHeading();

		new Setting(containerEl)
			.setName("Steps")
			.setDesc("Show nested checkboxes as steps, with a progress count on the parent task.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.enableSubtasks).onChange(async (v) => {
					this.plugin.settings.enableSubtasks = v;
					await this.plugin.saveSettings();
					this.plugin.refresh();
				})
			);

		new Setting(containerEl)
			.setName("Completed section")
			.setDesc("Default state for the completed group at the bottom of a list.")
			.addDropdown((d) =>
				d
					.addOption("collapsed", "Collapsed")
					.addOption("expanded", "Expanded")
					.addOption("hidden", "Hidden")
					.setValue(this.plugin.settings.showCompleted)
					.onChange(async (v) => {
						this.plugin.settings.showCompleted = v as ListsSettings["showCompleted"];
						await this.plugin.saveSettings();
						this.plugin.refresh();
					})
			);

		new Setting(containerEl)
			.setName("Importance")
			.setDesc(
				"A single star, or a 1–5 star rating where 5 is most important. Both write the same priority field, so switching never changes any file."
			)
			.addDropdown((d) =>
				d
					.addOption("star", "Star — on or off")
					.addOption("stars5", "Rating — 1 to 5 stars")
					.setValue(this.plugin.settings.importanceMode)
					.onChange(async (v) => {
						this.plugin.settings.importanceMode = v as ListsSettings["importanceMode"];
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					})
			);

		new Setting(containerEl)
			.setName("Default sort")
			.setDesc("Used by any list you have not sorted individually.")
			.addDropdown((d) => {
				for (const o of SORT_OPTIONS) d.addOption(o.key, o.label);
				d.setValue(this.plugin.settings.defaultSort).onChange(async (v) => {
					this.plugin.settings.defaultSort = v as SortKey;
					await this.plugin.saveSettings();
					this.plugin.refreshViews();
				});
			});

		new Setting(containerEl)
			.setName("Tidy list titles")
			.setDesc(
				"Show a list's name with hyphens and underscores as spaces, so \"weekly-review\" reads as \"weekly review\". Only names written without spaces are touched — a name you typed spaces into is your own punctuation and is left exactly as it is. This changes the title only: the file keeps the name it has, the tab shows that name, and clicking into the title to rename always puts the real filename in front of you, so a tidied title can never rename a file by itself. Turn it off to show the true filename everywhere."
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.prettyTitles).onChange(async (v) => {
					this.plugin.settings.prettyTitles = v;
					await this.plugin.saveSettings();
					this.plugin.refreshViews();
				})
			);

		new Setting(containerEl)
			.setName("Confetti when a task is completed")
			.setDesc(
				"A short burst from the checkbox, in the theme's own colours. Subtasks and steps do not set it off, only the task itself. Turned off automatically if the system asks for reduced motion."
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.confetti).onChange(async (v) => {
					this.plugin.settings.confetti = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Sparkle when a task is starred")
			.setDesc(
				"A glint from the star, in the same accent the star is drawn in. Only when importance is set, never when it is cleared. Turned off automatically if the system asks for reduced motion."
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.starBurst).onChange(async (v) => {
					this.plugin.settings.starBurst = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Shade alternate rows")
			.setDesc(
				"Give every other row a slightly different background, so a long row is easier to follow across. A list can turn this on or off for itself from its own menu; this decides what the rest do."
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.stripeRows).onChange(async (v) => {
					this.plugin.settings.stripeRows = v;
					await this.plugin.saveSettings();
					this.plugin.refreshViews();
				})
			);

		new Setting(containerEl)
			.setName("New lists start as")
			.setDesc(
				"Layout for a list that has not been given one of its own: rows, or a Google Keep-style post-it wall. Every list can be switched from its own header at any time, and that choice is written to the list's frontmatter, so this only decides where a new list begins."
			)
			.addDropdown((d) =>
				d
					.addOption("list", "Rows")
					.addOption("postit", "Post-it wall")
					.setValue(this.plugin.settings.defaultView)
					.onChange(async (v) => {
						this.plugin.settings.defaultView = v as ViewMode;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					})
			);

		new Setting(containerEl)
			.setName("Promoted tasks folder")
			.setDesc(
				"Where a task goes when you give it its own note. Keep it out of the lists folder, or the note becomes a list of its own. Leave empty for the vault root."
			)
			.addText((t) =>
				t
					.setPlaceholder("tasks")
					.setValue(this.plugin.settings.notesFolder)
					.onChange(async (v) => {
						this.plugin.settings.notesFolder = v.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName("Storage").setHeading();

		new Setting(containerEl)
			.setName("Metadata syntax")
			.setDesc(
				"How dates and priorities are written into a task line. Both formats are always read, so switching never breaks existing tasks; this only affects what gets written."
			)
			.addDropdown((d) =>
				d
					.addOption("emoji", "Emoji — 📅 2026-08-24")
					.addOption("dataview", "Inline fields — [due:: 2026-08-24]")
					.setValue(this.plugin.settings.dialect)
					.onChange(async (v) => {
						this.plugin.settings.dialect = v as Dialect;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Add completion date")
			.setDesc("Stamp ✅ with the date when a task is checked off.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.addDoneDate).onChange(async (v) => {
					this.plugin.settings.addDoneDate = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Add creation date")
			.setDesc(
				"Stamp ➕ with the date when a task is created. Needed for the two date-created sort options."
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.addCreatedDate).onChange(async (v) => {
					this.plugin.settings.addCreatedDate = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Include the time")
			.setDesc(
				"Stamp completed and created dates with the time as well: ✅ 2026-08-26T14:32 rather than ✅ 2026-08-26. Existing dates are left alone and both forms are always read, so this can be turned off again at any time. Off is what the Tasks plugin expects."
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.stampTime).onChange(async (v) => {
					this.plugin.settings.stampTime = v;
					await this.plugin.saveSettings();
				})
			);
	}
}
