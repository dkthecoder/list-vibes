import { App, Modal, Setting } from "obsidian";

/** Native date/time picker in a modal, so mobile gets the OS wheel. */
export class InputModal extends Modal {
	private opts: {
		title: string;
		type: "date" | "time" | "text";
		value?: string;
		onSubmit: (value: string) => void;
	};
	private value: string;

	constructor(app: App, opts: InputModal["opts"]) {
		super(app);
		this.opts = opts;
		this.value = opts.value ?? "";
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(this.opts.title);

		const input = contentEl.createEl("input", {
			type: this.opts.type,
			cls: "lists-modal-input",
		});
		input.value = this.value;
		input.addEventListener("change", () => (this.value = input.value));
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.value = input.value;
				this.submit();
			}
		});
		window.setTimeout(() => input.focus(), 0);

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText("Save")
					.setCta()
					.onClick(() => {
						this.value = input.value;
						this.submit();
					})
			);
	}

	private submit(): void {
		const v = this.value;
		this.close();
		if (v) this.opts.onSubmit(v);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
