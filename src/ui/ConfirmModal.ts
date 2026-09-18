import { App, Modal, Setting } from "obsidian";

/**
 * Yes-or-no, for an action that throws something away.
 *
 * Obsidian's own `Modal`, not an overlay of our own: it already handles the
 * backdrop, Escape, focus trapping and the mobile presentation, and a dialog
 * that behaves differently from every other dialog in the app is a worse dialog
 * however it looks.
 */
export class ConfirmModal extends Modal {
	private opts: {
		title: string;
		body?: string;
		/** Defaults to "Delete", since that is what this is nearly always for. */
		cta?: string;
		/** Red CTA. On by default, because a confirm implies something is lost. */
		destructive?: boolean;
		onConfirm: () => void | Promise<void>;
	};

	constructor(app: App, opts: ConfirmModal["opts"]) {
		super(app);
		this.opts = opts;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(this.opts.title);

		if (this.opts.body) {
			contentEl.createDiv({ cls: "lv-confirm-body", text: this.opts.body });
		}

		new Setting(contentEl)
			.addButton((b) => {
				b.setButtonText("Cancel").onClick(() => this.close());
				// Cancel takes focus, so Enter on a dialog you did not mean to
				// open is the harmless answer.
				window.setTimeout(() => b.buttonEl.focus(), 0);
			})
			.addButton((b) => {
				b.setButtonText(this.opts.cta ?? "Delete")
					.setCta()
					.onClick(() => {
						this.close();
						void this.opts.onConfirm();
					});
				if (this.opts.destructive !== false) b.setWarning();
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
