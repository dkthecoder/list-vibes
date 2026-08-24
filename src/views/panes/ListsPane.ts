import { Notice, TFile, normalizePath, setIcon } from "obsidian";
import { SMART_VIEWS, Selection, ViewContext, sameSelection } from "../context";
import { isComplete } from "../../model/types";

/** Left pane: smart views, then one row per list file in the folder. */
export function renderListsPane(parent: HTMLElement, ctx: ViewContext): void {
	const pane = parent.createDiv({ cls: "lists-pane lists-nav" });

	const scroll = pane.createDiv({ cls: "lists-nav-scroll" });

	/* --- smart views --- */
	const smart = scroll.createDiv({ cls: "lists-nav-group" });
	for (const v of SMART_VIEWS) {
		const count = ctx.store.countSmartView(v.id);
		row(smart, {
			icon: v.icon,
			label: v.label,
			count,
			selected: sameSelection(ctx.state.selection, { kind: "smart", view: v.id }),
			cls: `lists-smart-${v.id}`,
			onClick: () => ctx.select({ kind: "smart", view: v.id }),
		});
	}

	scroll.createDiv({ cls: "lists-nav-divider" });

	/* --- lists --- */
	const lists = ctx.store.getLists();
	const group = scroll.createDiv({ cls: "lists-nav-group" });

	if (!lists.length) {
		const empty = group.createDiv({ cls: "lists-empty-nav" });
		empty.createDiv({
			cls: "lists-empty-title",
			text: `No lists in "${ctx.store.getFolder()}"`,
		});
		empty.createDiv({
			cls: "lists-empty-body",
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
			selected: sameSelection(ctx.state.selection, { kind: "list", path: list.path }),
			onClick: () => ctx.select({ kind: "list", path: list.path }),
			onContext: (e) => showListMenu(e, ctx, list.path, list.name),
		});
	}

	/* --- new list --- */
	const foot = pane.createDiv({ cls: "lists-nav-foot" });
	const add = foot.createDiv({ cls: "lists-nav-row lists-new" });
	const addIcon = add.createDiv({ cls: "lists-nav-icon" });
	setIcon(addIcon, "plus");
	add.createDiv({ cls: "lists-nav-label", text: "New list" });
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
	onClick: () => void;
	onContext?: (e: MouseEvent) => void;
}

function row(parent: HTMLElement, o: RowOpts): void {
	const el = parent.createDiv({ cls: "lists-nav-row" });
	if (o.cls) el.addClass(o.cls);
	el.toggleClass("is-selected", o.selected);
	el.setAttribute("tabindex", "0");
	el.setAttribute("role", "button");

	const icon = el.createDiv({ cls: "lists-nav-icon" });
	if (o.emoji) icon.setText(o.emoji);
	else if (o.icon) setIcon(icon, o.icon);

	el.createDiv({ cls: "lists-nav-label", text: o.label });
	if (o.count > 0) el.createDiv({ cls: "lists-nav-count", text: String(o.count) });

	el.addEventListener("click", o.onClick);
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
	path: string,
	name: string
): void {
	e.preventDefault();
	// Imported lazily to keep the module graph flat.
	import("obsidian").then(({ Menu }) => {
		const menu = new Menu();
		menu.addItem((i) =>
			i
				.setTitle("Open as note")
				.setIcon("file-text")
				.onClick(() => void ctx.app.workspace.openLinkText(path, "", false))
		);
		menu.addItem((i) =>
			i
				.setTitle("Rename list")
				.setIcon("pencil")
				.onClick(() => void renameList(ctx, path, name))
		);
		menu.showAtMouseEvent(e);
	});
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

async function renameList(
	ctx: ViewContext,
	path: string,
	current: string
): Promise<void> {
	const { PromptModal } = await import("../../ui/PromptModal");
	new PromptModal(ctx.app, {
		title: "Rename list",
		value: current,
		cta: "Rename",
		onSubmit: async (value) => {
			const clean = value.trim().replace(/[\\/:]/g, "");
			if (!clean || clean === current) return;
			const file = ctx.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) return;
			const target = `${file.parent?.path ?? ""}/${clean}.md`.replace(/^\//, "");
			try {
				await ctx.app.fileManager.renameFile(file, target);
				ctx.select({ kind: "list", path: target });
			} catch (err) {
				new Notice(`Could not rename: ${String(err)}`);
			}
		},
	}).open();
}

export type { Selection };
