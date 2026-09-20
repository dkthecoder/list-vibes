import { Menu, Notice, normalizePath, setIcon } from "obsidian";
import { SMART_VIEWS, Selection, ViewContext, sameSelection } from "../context";
import { ListColor, TaskList, isComplete } from "../../model/types";
import { makeEditableName } from "../../ui/editableName";
import { makeDragSortable } from "../../ui/dragSort";
import { selectionKey } from "../viewState";

/** Left pane: smart views, then one row per list file in the folder. */
export function renderListsPane(parent: HTMLElement, ctx: ViewContext): void {
	const pane = parent.createDiv({ cls: "lv-pane lv-nav" });

	const scroll = pane.createDiv({ cls: "lv-nav-scroll" });

	/* --- smart views --- */
	const smart = scroll.createDiv({ cls: "lv-nav-group" });
	for (const v of SMART_VIEWS) {
		const count = ctx.store.countSmartView(v.id);
		row(smart, {
			icon: v.icon,
			label: v.label,
			count,
			selected: sameSelection(ctx.state.selection, { kind: "smart", view: v.id }),
			cls: `lv-smart-${v.id}`,
			selKey: selectionKey({ kind: "smart", view: v.id }),
			onClick: () => ctx.select({ kind: "smart", view: v.id }),
			onNewTab: () => ctx.openInNewTab({ kind: "smart", view: v.id }),
		});
	}

	scroll.createDiv({ cls: "lv-nav-divider" });

	/* --- lists --- */
	renamers.clear();
	const lists = ctx.orderedLists();
	const group = scroll.createDiv({ cls: "lv-nav-group" });

	if (!lists.length) {
		const empty = group.createDiv({ cls: "lv-empty-nav" });
		empty.createDiv({
			cls: "lv-empty-title",
			text: `No lists in "${ctx.store.getFolder()}"`,
		});
		empty.createDiv({
			cls: "lv-empty-body",
			text: "Create a list to get started, or point the plugin at an existing folder in settings.",
		});
	}

	/*
	 * Dragging a list is a preference, not an edit.
	 *
	 * Every other drag in the plugin rewrites a file, and is offered only under
	 * the file's own order for that reason. A list has no file order at all, so
	 * there is nothing a drag here could contradict — it is always available,
	 * and what it writes is settings.
	 */
	const rows: HTMLElement[] = [];
	const paths = lists.map((l) => l.path);

	for (const list of lists) {
		const open = list.tasks.filter((t) => !isComplete(t)).length;
		rows.push(row(group, {
			icon: list.config.icon ? undefined : "list",
			emoji: list.config.icon ?? undefined,
			label: list.name,
			count: open,
			color: list.config.color,
			accented: true,
			selected: sameSelection(ctx.state.selection, { kind: "list", path: list.path }),
			onClick: () => ctx.select({ kind: "list", path: list.path }),
			onNewTab: () => ctx.openInNewTab({ kind: "list", path: list.path }),
			onContext: (e) => showListMenu(e, ctx, list),
			onMenu: (e) => showListMenu(e, ctx, list),
			onRename: (next) => ctx.renameList(list.path, next),
			renameKey: list.path,
			selKey: selectionKey({ kind: "list", path: list.path }),
		}));
	}

	if (rows.length > 1) {
		rows.forEach((el, index) => {
			el.addClass("lv-sortable");
			makeDragSortable(el, {
				index,
				siblings: () => rows,
				onDrop: (from, to) => {
					const next = [...paths];
					next.splice(to, 0, ...next.splice(from, 1));
					ctx.reorderLists(next);
				},
			});
		});
	}

	/* --- new list --- */
	const foot = pane.createDiv({ cls: "lv-nav-foot" });
	const add = foot.createDiv({
		cls: "tree-item-self is-clickable tappable lv-nav-row lv-new",
	});
	const addIcon = add.createDiv({ cls: "lv-nav-icon" });
	setIcon(addIcon, "plus");
	add.createDiv({ cls: "tree-item-inner lv-nav-label", text: "New list" });
	add.setAttribute("tabindex", "0");
	const create = () => void newList(ctx);
	add.addEventListener("click", create);
	add.addEventListener("keydown", (e) => {
		if (e.key === "Enter") create();
	});
}

interface RowOpts {
	icon?: string;
	emoji?: string;
	label: string;
	count: number;
	selected: boolean;
	cls?: string;
	color?: ListColor;
	/** Draw the accent bar. Lists do, the smart views do not. */
	accented?: boolean;
	onClick: (e?: MouseEvent) => void;
	onContext?: (e: MouseEvent) => void;
	/** Modifier-click and middle-click target, when the row supports it. */
	onNewTab?: () => void;
	/** Renders a 3-dots button, so the menu is reachable without right-click. */
	onMenu?: (e: MouseEvent) => void;
	/** Makes the label renameable in place. Lists have one, smart views do not. */
	onRename?: (next: string) => void;
	/** Identifies the row so the Rename menu item can find its label. */
	renameKey?: string;
	/** Identifies what this row selects, so the highlight can move in place. */
	selKey?: string;
}

/**
 * Rows that can be renamed, by list path, so the Rename menu item can reach the
 * label it belongs to. The picker is rebuilt on every repaint, so this is
 * cleared and refilled each time rather than accumulating.
 */
const renamers = new Map<string, () => void>();

/**
 * One picker row, built on Obsidian's own tree vocabulary.
 *
 * `tree-item` / `tree-item-self` / `tree-item-inner` / `tree-item-flair` is the
 * generic tree markup behind the file explorer, the tag pane, the outline,
 * backlinks, search and bookmarks — and behind Obsidian's own first-party
 * Importer plugin, which builds its tree from exactly these classes. Themes
 * style it, so we inherit their treatment instead of approximating it.
 *
 * Every element is **dual-classed**: Obsidian's class for the theming, ours for
 * our own CSS and our own JS. Nothing in this plugin ever selects on a core
 * class. If Obsidian renames one we lose inherited polish and keep a working
 * view, which is the whole point of carrying both.
 *
 * `is-clickable` is not decoration either — core's hover rule is gated on it,
 * so without it a row has no hover state at all. `is-active` is used rather
 * than `is-selected`: it is the older, more conservative treatment, and there
 * is only ever one open list to highlight.
 */
function row(parent: HTMLElement, o: RowOpts): HTMLElement {
	const item = parent.createDiv({ cls: "tree-item lv-nav-item" });
	const el = item.createDiv({
		cls: "tree-item-self is-clickable tappable lv-nav-row",
	});
	if (o.cls) el.addClass(o.cls);
	if (o.color) el.addClass(`lv-color-${o.color}`);
	// Every list gets the bar. Without its own colour it inherits the accent
	// from the user's Obsidian appearance settings.
	el.toggleClass("is-coloured", !!o.accented);
	el.toggleClass("is-active", o.selected);
	el.toggleClass("is-selected", o.selected);
	// Lets the highlight move between rows without repainting the picker.
	if (o.selKey) el.dataset.lvSel = o.selKey;
	el.setAttribute("tabindex", "0");
	el.setAttribute("role", "button");

	const icon = el.createDiv({ cls: "lv-nav-icon" });
	if (o.emoji) icon.setText(o.emoji);
	else if (o.icon) setIcon(icon, o.icon);

	const label = el.createDiv({
		cls: "tree-item-inner lv-nav-label",
		text: o.label,
	});
	if (o.onRename) {
		// Renaming is armed by double-click, F2 or the menu — never by the click
		// that opens the list, which is what the row is primarily for.
		const editable = makeEditableName(label, {
			value: o.label,
			onCommit: o.onRename,
			onEditing: (on) => el.toggleClass("is-renaming", on),
		});
		if (o.renameKey) renamers.set(o.renameKey, editable.edit);
		el.addEventListener("keydown", (e) => {
			if (e.key === "F2") {
				e.preventDefault();
				editable.edit();
			}
		});
	}
	if (o.count > 0) {
		// Both elements are required: the outer one supplies `margin-inline-start:
		// auto`, so the count alone would not push right.
		el.createDiv({ cls: "tree-item-flair-outer" }).createSpan({
			cls: "tree-item-flair lv-nav-count",
			text: String(o.count),
		});
	}

	if (o.onMenu) {
		const more = el.createDiv({ cls: "clickable-icon lv-nav-more" });
		setIcon(more, "more-horizontal");
		more.setAttribute("aria-label", `Options for ${o.label}`);
		more.setAttribute("tabindex", "0");
		const openMenu = (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			o.onMenu?.(e);
		};
		more.addEventListener("click", openMenu);
		more.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				o.onMenu?.(e as unknown as MouseEvent);
			}
		});
	}

	el.addEventListener("click", (e) => {
		if (el.classList.contains("is-renaming")) return;
		if (o.onNewTab && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			o.onNewTab();
			return;
		}
		o.onClick(e);
	});
	// Middle-click opens in a new tab, as it does everywhere else in Obsidian.
	el.addEventListener("auxclick", (e) => {
		if (e.button === 1 && o.onNewTab) {
			e.preventDefault();
			o.onNewTab();
		}
	});
	el.addEventListener("keydown", (e) => {
		if (el.classList.contains("is-renaming")) return;
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			o.onClick();
		}
	});
	if (o.onContext) el.addEventListener("contextmenu", o.onContext);

	return item;
}

function showListMenu(
	e: MouseEvent,
	ctx: ViewContext,
	list: TaskList
): void {
	e.preventDefault();
	const menu = new Menu();

	menu.addItem((i) =>
		i
			.setTitle("Open in new tab")
			.setIcon("list-todo")
			.onClick(() => ctx.openInNewTab({ kind: "list", path: list.path }))
	);

	// Only worth offering once there is something to undo: an empty order is
	// alphabetical already, so the item would do nothing and say nothing.
	if (ctx.settings.listOrder.length) {
		menu.addItem((i) =>
			i
				.setTitle("Sort lists alphabetically")
				.setIcon("arrow-down-a-z")
				.onClick(() => ctx.reorderLists([]))
		);
	}

	menu.addSeparator();

	menu.addItem((i) =>
		i
			.setTitle("Rename")
			.setIcon("pencil")
			.onClick(() => {
				// Edit the row's own label. A modal for a one-word rename is a lot
				// of ceremony for something the file explorer does in place.
				const edit = renamers.get(list.path);
				if (edit) edit();
				else void renameList(ctx, list);
			})
	);

	menu.addItem((i) =>
		i
			.setTitle("Change icon")
			.setIcon("smile")
			.onClick(() => void pickIcon(ctx, list))
	);

	menu.addItem((i) =>
		i
			.setTitle("Change colour")
			.setIcon("palette")
			.onClick(() => void pickColor(ctx, list))
	);

	menu.addSeparator();

	menu.addItem((i) =>
		i
			.setTitle("Delete list")
			.setIcon("trash-2")
			.onClick(() => {
				const open = list.all.filter((t) => !isComplete(t)).length;
				void import("../../ui/ConfirmModal").then(({ ConfirmModal }) => {
					new ConfirmModal(ctx.app, {
						title: `Delete "${list.name}"?`,
						// Named rather than counted away: the file is the list, and
						// what happens to it is the vault's setting, not ours.
						body: open
							? `${list.name}.md holds ${open} unfinished task${open === 1 ? "" : "s"}. It goes wherever your vault sends deleted files.`
							: `${list.name}.md goes wherever your vault sends deleted files.`,
						cta: "Delete list",
						onConfirm: () => ctx.deleteList(list.path),
					}).open();
				});
			})
	);

	menu.addSeparator();

	menu.addItem((i) =>
		i
			.setTitle("Open as note")
			.setIcon("file-text")
			.onClick(() => void ctx.app.workspace.openLinkText(list.path, "", false))
	);

	menu.showAtMouseEvent(e);
}

async function pickColor(ctx: ViewContext, list: TaskList): Promise<void> {
	const { ColorModal } = await import("../../ui/ColorModal");
	new ColorModal(ctx.app, {
		listName: list.name,
		current: list.config.color,
		onPick: (color) => ctx.setColor(list.path, color),
	}).open();
}

async function newList(ctx: ViewContext): Promise<void> {
	const folder = normalizePath(ctx.store.getFolder());
	if (!ctx.app.vault.getAbstractFileByPath(folder)) {
		await ctx.app.vault.createFolder(folder).catch(() => undefined);
	}

	let name = "Untitled list";
	let n = 1;
	while (ctx.app.vault.getAbstractFileByPath(`${folder}/${name}.md`)) {
		name = `Untitled list ${++n}`;
	}

	try {
		const file = await ctx.app.vault.create(`${folder}/${name}.md`, "");
		ctx.select({ kind: "list", path: file.path });
	} catch (err) {
		new Notice(`Could not create list: ${String(err)}`);
	}
}

async function renameList(ctx: ViewContext, list: TaskList): Promise<void> {
	const { PromptModal } = await import("../../ui/PromptModal");
	new PromptModal(ctx.app, {
		title: "Rename list",
		value: list.name,
		cta: "Rename",
		onSubmit: (value) => ctx.renameList(list.path, value),
	}).open();
}

export type { Selection };

async function pickIcon(ctx: ViewContext, list: TaskList): Promise<void> {
	const { IconModal } = await import("../../ui/IconModal");
	new IconModal(ctx.app, {
		listName: list.name,
		current: list.config.icon,
		onPick: (icon) => ctx.setIcon(list.path, icon),
	}).open();
}
