import { App, Modal, Platform, Setting } from "obsidian";

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

		let field: HTMLInputElement | undefined;
		new Setting(contentEl)
			.setName("Emoji")
			.setDesc(
				// On a phone the keyboard is already up and its emoji key is
				// right there, so the desktop shortcuts are noise — and noise
				// that costs a line of a small screen.
				Platform.isMobile
					? "Tap the emoji key on your keyboard, or pick one below."
					: "Use your system's emoji picker — Ctrl+Cmd+Space on macOS, Win+. on Windows — or paste one in."
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

		/*
		 * The preselection.
		 *
		 * A row of sixteen was a shortcut on the assumption that the system
		 * picker was the real mechanism. On a phone it is not: focusing the field
		 * raises the keyboard on its letters, and there is no way to ask for the
		 * emoji panel — no web API offers one and neither platform exposes one —
		 * so reaching an emoji still costs a tap on the emoji key and a hunt.
		 * A grid you can see is faster than that, and it is what every other app
		 * that offers an icon does.
		 *
		 * It is deliberately a *selection*, not a catalogue. A complete picker
		 * needs names, search, skin tones and a data file that goes stale; this
		 * needs to cover the lists people actually keep, and the field beside it
		 * still takes anything at all.
		 */
		const quick = contentEl.createDiv({ cls: "lv-icon-quick" });
		const mark = () =>
			quick
				.findAll(".lv-icon-choice")
				.forEach((el) => el.toggleClass("is-on", el.getText() === this.value));

		for (const group of SUGGESTIONS) {
			quick.createDiv({ cls: "lv-icon-group", text: group.name });
			const row = quick.createDiv({ cls: "lv-icon-row" });
			for (const e of group.icons) {
				const b = row.createDiv({ cls: "lv-icon-choice", text: e });
				b.setAttribute("role", "button");
				b.setAttribute("tabindex", "0");
				b.setAttribute("aria-label", `Use ${e}`);
				b.toggleClass("is-on", e === this.value);
				const use = () => {
					this.value = e;
					if (field) field.value = e;
					mark();
					paint();
				};
				// `pointerdown` rather than `click`, and prevented: on a phone the
				// field may have the keyboard up, and letting the tap move focus
				// first closes it and shifts the grid out from under the finger
				// between press and release.
				b.addEventListener("pointerdown", (ev) => ev.preventDefault());
				b.addEventListener("click", use);
				b.addEventListener("keydown", (ev) => {
					if (ev.key === "Enter" || ev.key === " ") {
						ev.preventDefault();
						use();
					}
				});
			}
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

		/*
		 * The caret goes in the field on a desktop and stays out of it on a phone.
		 *
		 * The previous version focused it everywhere, on the theory that a
		 * raised keyboard puts the emoji key within reach. In practice the
		 * keyboard comes up on its letters — there is no way to ask for the
		 * emoji panel, no web API offers one and neither platform exposes one —
		 * so all it did was cover the grid with a keyboard nobody wanted, and
		 * reaching an emoji still cost a tap on the emoji key and a hunt.
		 *
		 * So the grid is what greets you, and the field is still there for the
		 * system picker: tap it and the keyboard comes up, emoji key and all.
		 */
		if (!Platform.isMobile) window.setTimeout(() => field?.focus(), 0);
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

/**
 * The preselection, grouped the way lists tend to be.
 *
 * Chosen for what a to-do list gets called rather than for coverage: work,
 * home, money, travel, food, health, study, projects. Anything not here is a
 * paste or a tap of the emoji key away, which is the point of keeping the field.
 *
 * Everything is a single grapheme with no skin tone and no variation selector
 * beyond the ones the glyph needs, so what is stored is what was shown.
 */
const SUGGESTIONS: { name: string; icons: string[] }[] = [
	{
		name: "Everyday",
		icons: ["📋", "✅", "⭐", "🔥", "📌", "🗒️", "🔖", "📝", "⏰", "🔔", "🎯", "💡"],
	},
	{
		name: "Work and study",
		icons: ["💼", "🏢", "📊", "📈", "💻", "🖥️", "📞", "✉️", "📚", "🎓", "🔬", "✏️"],
	},
	{
		name: "Home and errands",
		icons: ["🏠", "🛒", "🧺", "🧹", "🔧", "🪛", "🧾", "📦", "🐕", "🐈", "🪴", "🚗"],
	},
	{
		name: "Money",
		icons: ["💰", "💳", "🏦", "💸", "🧮", "📉"],
	},
	{
		name: "Health and sport",
		icons: ["💪", "🏃", "🚴", "🧘", "⚽", "🏋️", "💊", "🩺", "🦷", "😴"],
	},
	{
		name: "Food and drink",
		icons: ["🍽️", "🍳", "🥗", "🍕", "🍜", "☕", "🍰", "🍎"],
	},
	{
		name: "Travel and places",
		icons: ["✈️", "🧳", "🗺️", "🏖️", "⛰️", "🏕️", "🚆", "🎡"],
	},
	{
		name: "Fun",
		icons: ["🎮", "🎬", "🎵", "🎨", "📷", "🎧", "🕹️", "🎲", "🎸", "🃏"],
	},
	{
		name: "People and moments",
		icons: ["🎁", "🎉", "❤️", "👶", "👨‍👩‍👧", "💍", "🎂", "🕯️"],
	},
	{
		name: "Signals",
		icons: ["🚀", "⚡", "🌟", "🌈", "🔴", "🟠", "🟡", "🟢", "🔵", "🟣"],
	},
];
