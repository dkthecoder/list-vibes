import { App, Modal, Setting } from "obsidian";

/** Small single-field prompt, used for renames and similar. */
export class PromptModal extends Modal {
	private opts: {
		title: string;
		value?: string;
		placeholder?: string;
		cta?: string;
		onSubmit: (value: string) => void | Promise<void>;
	};
	private value: string;

	constructor(app: App, opts: PromptModal["opts"]) {
		super(app);
		this.opts = opts;
		this.value = opts.value ?? "";
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(this.opts.title);

		const setting = new Setting(contentEl).addText((t) => {
			t.setValue(this.value)
				.setPlaceholder(this.opts.placeholder ?? "")
				.onChange((v) => (this.value = v));
			t.inputEl.addClass("lv-prompt-input");
			t.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					void this.submit();
				}
			});
			window.setTimeout(() => {
				t.inputEl.focus();
				t.inputEl.select();
			}, 0);
		});
		setting.infoEl.remove();

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(this.opts.cta ?? "Save")
					.setCta()
					.onClick(() => void this.submit())
			);
	}

	private async submit(): Promise<void> {
		const v = this.value;
		this.close();
		await this.opts.onSubmit(v);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
