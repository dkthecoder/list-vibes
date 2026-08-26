import { App, Modal, Notice } from "obsidian";
import { measure } from "./diagnostics";

/**
 * A throwaway probe for the mobile keyboard, to be deleted once it has answered.
 *
 * Five fixes have failed, and every one of them was a plausible mechanism with
 * no way to check it from a machine that has no soft keyboard. This does not fix
 * anything. It asks two questions at once, on the device, and shows the answers
 * there rather than shipping them back through a note.
 *
 * **Does a core Modal survive the keyboard?** A Modal is appended to
 * `document.body`, outside `.app-container`, outside the workspace leaf and
 * outside the `contain: strict` on it. If the view behind blanks while this
 * stays put, the detail panel belongs in a Modal on touch and the question is
 * settled. If this blanks too, the Modal is not the answer and a real workspace
 * screen is the next thing to try — learned for the price of one tap.
 *
 * **What happens at the moment it blanks?** The report says
 * "the screen moves a bit as the keyboard loads up, then as soon as the
 * animation finishes everything vanishes". Core has exactly two rules on that
 * moment:
 *
 *     body.is-mobile.keyboard-animating .app-container { max-height: 100vh }
 *     body.is-mobile                    .app-container { max-height: calc(100vh - var(--keyboard-height)) }
 *
 * So the app is full height while the keyboard animates and clamped the instant
 * it stops. The readout below watches `keyboard-animating` come and go beside
 * the container's actual height, which turns that from a story into a number.
 */

/** The handful of readings that would tell one explanation from another. */
const WATCHED = [
	"body.class",
	"--keyboard-height",
	".app-container",
	".view-content (.lv-root)",
	".lv-root client",
	"window.inner",
	"visualViewport",
	"visualViewport.scale",
	"window.scroll",
	"focused font-size",
];

export class KeyboardProbeModal extends Modal {
	private rows = new Map<string, HTMLElement>();
	private log: string[] = [];
	private stop: (() => void)[] = [];
	private root: () => HTMLElement | null;

	constructor(app: App, root: () => HTMLElement | null) {
		super(app);
		this.root = root;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("lv-probe");
		this.setTitle("Keyboard probe");

		contentEl.createEl("p", {
			cls: "lv-probe-hint",
			text:
				"Tap the field below and let the keyboard finish opening. If this box stays put while the list behind it blanks, the detail panel belongs in a box like this one.",
		});

		const field = contentEl.createEl("input", {
			type: "text",
			cls: "lv-probe-field",
			attr: { placeholder: "Tap here", "aria-label": "Probe field" },
		});

		const table = contentEl.createDiv({ cls: "lv-probe-table" });
		for (const key of WATCHED) {
			const row = table.createDiv({ cls: "lv-probe-row" });
			row.createSpan({ cls: "lv-probe-key", text: key });
			this.rows.set(key, row.createSpan({ cls: "lv-probe-value", text: "…" }));
		}

		/*
		 * The modal's own rectangle, which is the point of the exercise. It is
		 * measured rather than assumed: "it stayed put" and "it stayed put and
		 * got shorter" look the same from the outside and mean different things.
		 */
		const selfRow = table.createDiv({ cls: "lv-probe-row is-self" });
		selfRow.createSpan({ cls: "lv-probe-key", text: "this box" });
		const selfValue = selfRow.createSpan({ cls: "lv-probe-value", text: "…" });

		const events = contentEl.createDiv({ cls: "lv-probe-log" });

		const win = contentEl.win;
		let last = "";

		const refresh = (label?: string) => {
			const values = measure(win, this.root());
			for (const key of WATCHED) {
				const cell = this.rows.get(key);
				if (cell) cell.setText(String(values[key] ?? "—"));
			}
			const r = this.modalEl.getBoundingClientRect();
			selfValue.setText(
				`${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)}`
			);

			// Only note a moment when something actually changed, so the log is a
			// list of transitions rather than a wall of identical ticks.
			const fingerprint = `${values["body.class"]}|${values["--keyboard-height"]}|${values[".app-container"]}`;
			if (label || fingerprint !== last) {
				last = fingerprint;
				const line = `${label ? label + " — " : ""}kb=${values["--keyboard-height"]} app=${values[".app-container"]} view=${values[".lv-root client"]}`;
				this.log.push(line);
				events.createDiv({ cls: "lv-probe-event", text: line });
				// Newest at the bottom, and the bottom is where the eye is.
				events.scrollTop = events.scrollHeight;
			}
		};

		const on = (target: EventTarget, type: string, label?: string) => {
			const fn = () => win.setTimeout(() => refresh(label), 0);
			target.addEventListener(type, fn);
			this.stop.push(() => target.removeEventListener(type, fn));
		};

		// The two that bracket the moment being investigated get named in the log.
		on(win, "keyboardWillShow", "keyboard opening");
		on(win, "keyboardDidShow", "keyboard settled");
		on(win, "keyboardWillHide", "keyboard closing");
		on(win, "keyboardDidHide", "keyboard gone");
		on(win, "resize");
		if (win.visualViewport) {
			on(win.visualViewport, "resize");
			on(win.visualViewport, "scroll");
		}
		on(contentEl, "focusin");
		on(contentEl, "focusout");

		// And a tick, because the transition that matters happens between events:
		// `keyboard-animating` is removed by core without telling anybody.
		const timer = win.setInterval(() => refresh(), 100);
		this.stop.push(() => win.clearInterval(timer));

		new Notice("Probe open. Tap the field and watch the numbers.", 5000);
		refresh("opened");
		void field;
	}

	onClose(): void {
		for (const fn of this.stop) fn();
		this.stop = [];
		// The log is the deliverable, and a phone is a poor place to read one.
		void navigator.clipboard
			?.writeText(this.log.join("\n"))
			.then(() => new Notice("Probe log copied to the clipboard.", 4000))
			.catch(() => {
				/* Clipboard access is not guaranteed; the note-writing report
				   command is the fallback and says so in the README. */
			});
		this.contentEl.empty();
	}
}
