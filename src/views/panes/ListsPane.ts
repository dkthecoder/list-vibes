import { Menu, Notice, normalizePath, setIcon } from "obsidian";
import { SMART_VIEWS, Selection, ViewContext, sameSelection } from "../context";
import { ListColor, TaskList, isComplete } from "../../model/types";

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
			onClick: () => ctx.select({ kind: "smart", view: v.id }),
			onNewTab: () => ctx.openInNewTab({ kind: "smart", view: v.id }),
		});
	}

	scroll.createDiv({ cls: "lv-nav-divider" });

	/* --- lists --- */
	const lists = ctx.store.getLists();
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

	for (const list of lists) {
		const open = list.tasks.filter((t) => !isComplete(t)).length;
		row(group, {
			icon: list.config.icon ? undefined : "list",
			emoji: list.config.icon ?? undefined,
			label: list.name,
			count: open,
			color: list.config.color,
			selected: sameSelection(ctx.state.selection, { kind: "list", path: list.path }),
			onClick: () => ctx.select({ kind: "list", path: list.path }),
			onNewTab: () => ctx.openInNewTab({ kind: "list", path: list.path }),
			onContext: (e) => showListMenu(e, ctx, list),
			onMenu: (e) => showListMenu(e, ctx, list),
		});
	}

	/* --- new list --- */
	const foot = pane.createDiv({ cls: "lv-nav-foot" });
	const add = foot.createDiv({ cls: "lv-nav-row lv-new" });
	const addIcon = add.createDiv({ cls: "lv-nav-icon" });
	setIcon(addIcon, "plus");
	add.createDiv({ cls: "lv-nav-label", text: "New list" });
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
	onClick: (e?: MouseEvent) => void;
	onContext?: (e: MouseEvent) => void;
	/** Modifier-click and middle-click target, when the row supports it. */
	onNewTab?: () => void;
	/** Renders a 3-dots button, so the menu is reachable without right-click. */
	onMenu?: (e: MouseEvent) => void;
}

function row(parent: HTMLElement, o: RowOpts): void {
	const el = parent.createDiv({ cls: "lv-nav-row" });
	if (o.cls) el.addClass(o.cls);
	if (o.color) el.addClass(`lv-color-${o.color}`);
	el.toggleClass("is-coloured", !!o.color);
	el.toggleClass("is-selected", o.selected);
	el.setAttribute("tabindex", "0");
	el.setAttribute("role", "button");

	const icon = el.createDiv({ cls: "lv-nav-icon" });
	if (o.emoji) icon.setText(o.emoji);
	else if (o.icon) setIcon(icon, o.icon);

	el.createDiv({ cls: "lv-nav-label", text: o.label });
	if (o.count > 0) el.createDiv({ cls: "lv-nav-count", text: String(o.count) });

	if (o.onMenu) {
		const more = el.createDiv({ cls: "lv-nav-more" });
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
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			o.onClick();
		}
	});
	if (o.onContext) el.addEventListener("contextmenu", o.onContext);
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

	menu.addSeparator();

	menu.addItem((i) =>
		i
			.setTitle("Rename")
			.setIcon("pencil")
			.onClick(() => void renameList(ctx, list))
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
