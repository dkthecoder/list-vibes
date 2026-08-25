import { App, Modal, setIcon } from "obsidian";
import { LIST_COLORS, ListColor } from "../model/types";

/**
 * Swatch picker for a list's colour.
 *
 * A modal rather than menu items: nine colours plus "none" makes a menu long
 * and unreadable, and swatches are the point — you pick a colour by seeing it.
 */
export class ColorModal extends Modal {
	private current: ListColor | undefined;
	private onPick: (color: ListColor | null) => void;
	private listName: string;

	constructor(
		app: App,
		opts: {
			listName: string;
			current?: ListColor;
			onPick: (color: ListColor | null) => void;
		}
	) {
		super(app);
		this.listName = opts.listName;
		this.current = opts.current;
		this.onPick = opts.onPick;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(`Colour for ${this.listName}`);

		contentEl.createDiv({
			cls: "lv-swatches-hint",
			text: "The first swatch is your Obsidian accent colour, used by every list you have not given one of its own.",
		});

		const grid = contentEl.createDiv({ cls: "lv-swatches" });

		// Default first, so reverting is as reachable as customising. "Default"
		// is not the absence of a colour — it is the accent from the user's own
		// Obsidian appearance settings, so the swatch shows that colour.
		const none = grid.createDiv({ cls: "lv-swatch lv-swatch-none" });
		none.toggleClass("is-selected", !this.current);
		none.setAttribute("role", "button");
		none.setAttribute("tabindex", "0");
		none.setAttribute("aria-label", "Theme accent colour");
		if (!this.current) setIcon(none, "check");
		this.wire(none, null);

		for (const color of LIST_COLORS) {
			const sw = grid.createDiv({ cls: `lv-swatch lv-color-${color}` });
			sw.toggleClass("is-selected", this.current === color);
			sw.setAttribute("role", "button");
			sw.setAttribute("tabindex", "0");
			sw.setAttribute("aria-label", color);
			if (this.current === color) setIcon(sw, "check");
			this.wire(sw, color);
		}
	}

	private wire(el: HTMLElement, color: ListColor | null): void {
		const choose = () => {
			this.close();
			this.onPick(color);
		};
		el.addEventListener("click", choose);
		el.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				choose();
			}
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
