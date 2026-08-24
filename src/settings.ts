import { App, PluginSettingTab, Setting } from "obsidian";
import type ListsPlugin from "./main";
import { Dialect } from "./model/types";

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
	/** Last opened list, restored on reopen. */
	lastList?: string;
}

export const DEFAULT_SETTINGS: ListsSettings = {
	folder: "lists",
	dialect: "emoji",
	enableSubtasks: true,
	side: "left",
	showCompleted: "collapsed",
	addDoneDate: true,
	addCreatedDate: false,
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
			.setDesc("Stamp ➕ with the date when a task is created.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.addCreatedDate).onChange(async (v) => {
					this.plugin.settings.addCreatedDate = v;
					await this.plugin.saveSettings();
				})
			);
	}
}
