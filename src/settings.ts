import { App, PluginSettingTab, SettingDefinitionItem } from "obsidian";
import type ListsPlugin from "./main";
import { Dialect, ViewMode } from "./model/types";
import { GROUP_SORT_OPTIONS, GroupSortKey, SORT_OPTIONS, SortKey } from "./model/sort";

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
	/**
	 * How the `##` headings themselves are ordered.
	 *
	 * Its own question, not a consequence of the task sort: a group has no due
	 * date and no importance of its own, so organising within the groups and
	 * organising the groups are chosen separately.
	 */
	defaultGroupSort: GroupSortKey;
	groupSortByList: Record<string, GroupSortKey>;
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
	/** Throw confetti when a task is completed. Ignored under reduced motion. */
	confetti: boolean;
	/** Glint when a task is starred. Ignored under reduced motion. */
	starBurst: boolean;
	/**
	 * Remove a `##` heading once the last task leaves it.
	 *
	 * Off by default: an empty section you are about to fill is a normal thing
	 * to want, and one that vanishes under you as you drag the last task out is
	 * worse than a heading left behind for you to delete yourself.
	 */
	autoRemoveEmptySections: boolean;
	/**
	 * Lift starred tasks into a band of their own at the top of a list.
	 *
	 * A band in the view, never a `## Starred` heading in the file: starring
	 * would otherwise move a task out of its own section and unstarring would
	 * have to guess where to put it back. On by default, because a star that
	 * does not move anything is a star that does very little.
	 */
	starredSection: boolean;
	/**
	 * Draw `##` headings as groups.
	 *
	 * The default for lists that have not said otherwise in their own
	 * frontmatter. Off shows one flat list, and each row then carries its
	 * heading as a badge, so nothing about where a task lives is lost.
	 */
	showGroups: boolean;
	/**
	 * Give every list its own tab rather than reusing one.
	 *
	 * On by default. A tab is then only ever created or focused, never handed a
	 * different list — which is the only reliable way to keep its title honest,
	 * because Obsidian rereads a custom view's name on its own schedule and no
	 * public API asks it to.
	 *
	 * Turning it off brings back one shared tab, and with it a title that can
	 * name the list the tab used to hold.
	 */
	listOwnTab: boolean;
	/** Per-list layout override, keyed by file path. */
	viewByList: Record<string, ViewMode>;
	/**
	 * Folded sections, keyed by file path, holding section names.
	 *
	 * By name rather than by line, because a line moves the moment anything above
	 * it is edited and a fold that jumps to a different section is worse than one
	 * that is occasionally shared by two headings of the same name. View-only,
	 * like sort: never written to the file.
	 */
	collapsedSections: Record<string, string[]>;
	/**
	 * The order the lists were dragged into, by path.
	 *
	 * Empty means alphabetical, because an order nobody has set orders nothing —
	 * so there is no mode to choose and no setting to explain. View-only, like
	 * every other ordering the plugin keeps.
	 */
	listOrder: string[];
	/** Last opened list, restored on reopen. */
	lastList?: string;
}

export const DEFAULT_SETTINGS: ListsSettings = {
	folder: "lists",
	dialect: "emoji",
	enableSubtasks: true,
	side: "left",
	showCompleted: "collapsed",
	confetti: true,
	starBurst: true,
	addDoneDate: true,
	addCreatedDate: true,
	stampTime: true,
	importanceMode: "star",
	defaultSort: "custom",
	defaultGroupSort: "custom",
	groupSortByList: {},
	sortByList: {},
	prettyTitles: true,
	defaultView: "list",
	viewByList: {},
	autoRemoveEmptySections: false,
	starredSection: true,
	showGroups: true,
	listOwnTab: true,
	collapsedSections: {},
	listOrder: [],
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

	/*
	 * Declared rather than built.
	 *
	 * A settings tab that constructs its own rows is invisible to Obsidian's
	 * settings search: someone looking for "starred" or "groups" finds nothing,
	 * because nothing told the app these settings exist. Describing them lets
	 * the app render *and* index them, and the rendering stops being ours to
	 * get right.
	 *
	 * Reading and writing come free — the defaults use `plugin.settings`, and
	 * every key here is a field on it. Only the repaint a change needs is ours,
	 * and that is what `setControlValue` below adds.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const sorts: Record<string, string> = {};
		for (const o of SORT_OPTIONS) sorts[o.key] = o.label;

		return [
			{
				type: "group",
				heading: "Lists",
				items: [
					{
						name: "Lists folder",
						desc: "The folder of markdown files this plugin reads. Avoid a dot-prefixed name; Obsidian hides those.",
						control: { type: "folder", key: "folder" },
					},
					{
						name: "Sidebar",
						desc: "Which sidebar the view opens in. Mobile cannot move a tab between them, so it has to be chosen here.",
						control: {
							type: "dropdown",
							key: "side",
							options: { left: "Left", right: "Right" },
						},
					},
					{
						name: "Show in the sidebar on startup",
						control: { type: "toggle", key: "openOnStartup" },
					},
					{
						name: "Put it first in the sidebar",
						desc: "Only the first time the view is created.",
						control: { type: "toggle", key: "sidebarFirst" },
					},
					{
						name: "Open lists in a tab",
						desc: "From the sidebar, picking a list opens it in the main area and the sidebar stays a picker.",
						control: { type: "toggle", key: "openListsInTab" },
					},
					{
						name: "A tab per list",
						desc: "Open each list in its own tab instead of reusing one. Turn it off for a single shared tab, at the cost of a tab title that can name the list it used to hold.",
						aliases: ["tabs", "reuse"],
						control: { type: "toggle", key: "listOwnTab" },
					},
					{
						name: "Tidy list titles",
						desc: "Show `my-work-list` as \"my work list\" above the tasks. Display only; the file keeps its name.",
						control: { type: "toggle", key: "prettyTitles" },
					},
					{
						name: "New lists start as",
						control: {
							type: "dropdown",
							key: "defaultView",
							options: { list: "Rows", postit: "Post-it wall" },
						},
					},
				],
			},
			{
				type: "group",
				heading: "Tasks",
				items: [
					{
						name: "Steps",
						desc: "Show nested checkboxes as steps, with a progress count on the parent task.",
						aliases: ["subtasks"],
						control: { type: "toggle", key: "enableSubtasks" },
					},
					{
						name: "Starred at the top",
						desc: "Lift starred tasks into a band of their own above the list. Nothing is written to your file, and the band is only there while something is starred.",
						control: { type: "toggle", key: "starredSection" },
					},
					{
						name: "Show groups",
						desc: "Draw a list's ## headings as groups. Off shows one flat list, with each task carrying its heading as a badge. A list can override this in its own frontmatter with groups: shown or groups: hidden.",
						aliases: ["sections", "headings"],
						control: { type: "toggle", key: "showGroups" },
					},
					{
						name: "Tidy away empty groups",
						desc: "Remove a heading once the last task leaves it. Off by default, so a group you are about to fill does not vanish as you drag.",
						aliases: ["sections"],
						control: { type: "toggle", key: "autoRemoveEmptySections" },
					},
					{
						name: "Completed tasks",
						desc: "Default state for the completed group at the bottom of a list.",
						control: {
							type: "dropdown",
							key: "showCompleted",
							options: {
								collapsed: "Collapsed",
								expanded: "Expanded",
								hidden: "Hidden",
							},
						},
					},
					{
						name: "Importance",
						desc: "A single star, or a rating from one to five.",
						aliases: ["priority", "star"],
						control: {
							type: "dropdown",
							key: "importanceMode",
							options: { star: "Star", stars5: "Five stars" },
						},
					},
					{
						name: "Default group order",
						desc: "Applied to lists that have not been given their own. Groups are ordered separately from the tasks inside them.",
						aliases: ["sections", "headings"],
						control: {
							type: "dropdown",
							key: "defaultGroupSort",
							options: Object.fromEntries(
								GROUP_SORT_OPTIONS.map((o) => [o.key, o.label])
							),
						},
					},
					{
						name: "Default sort",
						desc: "Applied to lists that have not been given their own.",
						control: { type: "dropdown", key: "defaultSort", options: sorts },
					},
					{
						name: "Promoted tasks folder",
						desc: "Where a task becomes a note when promoted. Empty means the vault root.",
						control: { type: "folder", key: "notesFolder" },
					},
				],
			},
			{
				type: "group",
				heading: "Flourishes",
				items: [
					{
						name: "Confetti when a task is completed",
						control: { type: "toggle", key: "confetti" },
					},
					{
						name: "Sparkle when a task is starred",
						control: { type: "toggle", key: "starBurst" },
					},
				],
			},
			{
				type: "group",
				heading: "Storage",
				items: [
					{
						name: "Metadata syntax",
						desc: "Which inline syntax to write. Both are always read, so switching never breaks anything already on disk.",
						aliases: ["dataview", "emoji", "tasks"],
						control: {
							type: "dropdown",
							key: "dialect",
							options: { emoji: "Emoji (Obsidian Tasks)", dataview: "Dataview fields" },
						},
					},
					{
						name: "Add completion date",
						desc: "Stamp a date when a task is ticked.",
						control: { type: "toggle", key: "addDoneDate" },
					},
					{
						name: "Add creation date",
						desc: "Stamp a date on newly created tasks.",
						control: { type: "toggle", key: "addCreatedDate" },
					},
					{
						name: "Include the time",
						desc: "Write a time alongside the completion and creation dates.",
						control: { type: "toggle", key: "stampTime" },
					},
				],
			},
		];
	}

	/**
	 * Store the value, then repaint whatever it changed.
	 *
	 * The base class already writes and persists; only the consequence is ours.
	 * Which consequence depends on the key: a folder or a syntax change means
	 * rereading the vault, a layout change means only repainting what is open,
	 * and most mean nothing at all.
	 */
	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);

		if (REREAD.has(key)) this.plugin.refresh();
		else if (REPAINT.has(key)) this.plugin.refreshViews();
	}
}

/** Changes that mean the folder has to be read again. */
const REREAD = new Set(["folder", "enableSubtasks", "showCompleted"]);

/** Changes that only alter what is already on screen. */
const REPAINT = new Set([
	"starredSection",
	"defaultGroupSort",
	"importanceMode",
	"defaultSort",
	"prettyTitles",
	"defaultView",
]);

