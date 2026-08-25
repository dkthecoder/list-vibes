import { App, Modal, Setting } from "obsidian";

/**
 * Pick the emoji shown beside a list's name.
 *
 * The value lands in the list's frontmatter as `icon:`, not in its filename.
 * An emoji in the filename is still read as a fallback — plenty of vaults name
 * files that way, including this one's — but it is a poor place to *store* one:
 * changing it renames the file, which rewrites every link pointing at it, and
 * an emoji in a path travels badly across sync clients and filesystems.
 *
 * The field is a plain text input on purpose. Obsidian has no public emoji
 * picker, and rather than ship a hardcoded grid pretending to be one, this uses
 * the picker the operating system already has: the emoji key on a phone
 * keyboard, and Ctrl+Cmd+Space on macOS or Win+. on Windows. That is a real
 * native picker, always current, and it costs nothing to maintain. The row of
 * suggestions below is a shortcut, not the mechanism.
 */
export class IconModal extends Modal {
	private listName: string;
	private current?: string;
	private onPick: (icon: string | null) => void;
	private value: string;

	constructor(
		app: App,
		opts: { listName: string; current?: string; onPick: (icon: string | null) => void }
	) {
		super(app);
		this.listName = opts.listName;
		this.current = opts.current;
		this.onPick = opts.onPick;
		this.value = opts.current ?? "";
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("lv-icon-modal");
		this.setTitle(`Icon for ${this.listName}`);

		const preview = contentEl.createDiv({ cls: "lv-icon-preview" });
		const glyph = preview.createDiv({ cls: "lv-icon-glyph" });
		const hint = preview.createDiv({ cls: "lv-icon-hint" });

		const paint = () => {
			glyph.setText(this.value || "—");
			glyph.toggleClass("is-empty", !this.value);
			hint.setText(
				this.value ? "" : "No icon — the list shows a generic one."
			);
		};

		let field: HTMLInputElement;
		new Setting(contentEl)
			.setName("Emoji")
			.setDesc(
				"Use your system's emoji picker — the emoji key on a phone keyboard, Ctrl+Cmd+Space on macOS, Win+. on Windows — or paste one in."
			)
			.addText((t) => {
				field = t.inputEl;
				t.setPlaceholder("📋")
					.setValue(this.value)
					.onChange((v) => {
						this.value = firstGlyph(v);
						// Reflect the trim back, so pasting a whole sentence visibly
						// keeps only the first character rather than silently doing so.
						if (t.inputEl.value !== this.value) t.inputEl.value = this.value;
						paint();
					});
				t.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						this.commit();
					}
				});
			});

		const quick = contentEl.createDiv({ cls: "lv-icon-quick" });
		for (const e of SUGGESTIONS) {
			const b = quick.createDiv({ cls: "lv-icon-choice", text: e });
			b.setAttribute("role", "button");
			b.setAttribute("tabindex", "0");
			b.setAttribute("aria-label", `Use ${e}`);
			b.toggleClass("is-on", e === this.value);
			const use = () => {
				this.value = e;
				if (field) field.value = e;
				quick.findAll(".lv-icon-choice").forEach((el) =>
					el.toggleClass("is-on", el.getText() === e)
				);
				paint();
			};
			b.addEventListener("click", use);
			b.addEventListener("keydown", (ev) => {
				if (ev.key === "Enter" || ev.key === " ") {
					ev.preventDefault();
					use();
				}
			});
		}

		new Setting(contentEl)
			.addExtraButton((b) =>
				b
					.setIcon("rotate-ccw")
					.setTooltip("Remove the icon")
					.onClick(() => {
						this.value = "";
						if (field) field.value = "";
						paint();
					})
			)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setCta()
					.setButtonText("Save")
					.onClick(() => this.commit())
			);

		paint();
		window.setTimeout(() => field?.focus(), 0);
	}

	private commit(): void {
		this.onPick(this.value || null);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * The first glyph of a string, counted the way a person counts characters.
 *
 * Splitting by code unit would cut a flag or a skin-toned emoji in half —
 * "👍🏽" is four code units and "🇬🇧" is two code points — so this walks
 * grapheme clusters where the platform can, and falls back to code points,
 * which is still right for the common single-emoji case.
 */
export function firstGlyph(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return "";

	const Seg = (
		Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }
	).Segmenter;
	if (Seg) {
		for (const s of new Seg(undefined, { granularity: "grapheme" }).segment(trimmed)) {
			return s.segment;
		}
		return "";
	}
	return [...trimmed][0] ?? "";
}

/** A shortcut, not a substitute for the system picker. */
const SUGGESTIONS = [
	"📋", "✅", "⭐", "🔥", "💼", "🏠", "🛒", "🎯",
	"📚", "💡", "🎮", "🎬", "🍽️", "✈️", "💪", "🎵",
];
