/**
 * An editable list name.
 *
 * A list's name *is* its filename, so committing one of these renames a file
 * and Obsidian updates every link pointing at it. That is a real edit to the
 * vault, which is why an empty name or an unchanged one is silently reverted
 * rather than written.
 *
 * Two shapes, one implementation:
 *
 * - **Always editable** — the list header, which is a title. Click into it and
 *   type, like renaming a file in a title bar.
 * - **On demand** — a picker row, which is a *button*. Leaving it permanently
 *   contenteditable would swallow the click that opens the list, so editing is
 *   armed explicitly (double-click, F2, or the Rename menu item) and disarmed
 *   the moment it ends.
 */

export interface EditableNameOptions {
	/**
	 * The current name — the real one, the one that is also the filename. This
	 * is what the field is seeded with when it takes focus, what an unchanged
	 * commit is compared against, and what gets written.
	 */
	value: string;
	/**
	 * What to show while nobody is editing, if that differs — a tidied title,
	 * say. Editing always swaps back to `value`, so what you edit is what will
	 * be written and a display flourish can never rename a file by itself.
	 */
	display?: string;
	/** Called only when the name actually changed to something non-empty. */
	onCommit: (next: string) => void;
	/**
	 * Whether the element is a text field at rest. False makes it a plain label
	 * until `edit()` is called.
	 */
	alwaysEditable?: boolean;
	/**
	 * Told when editing starts and stops, so a row can suppress the click and
	 * drag handlers that would otherwise fire while the user is typing.
	 */
	onEditing?: (editing: boolean) => void;
}

export interface EditableName {
	/** Enter edit mode, with the whole name selected so typing replaces it. */
	edit: () => void;
}

export function makeEditableName(
	el: HTMLElement,
	opts: EditableNameOptions
): EditableName {
	const always = opts.alwaysEditable === true;
	let editing = always;
	const shown = () => opts.display ?? opts.value;

	el.setText(shown());
	el.setAttribute("role", "textbox");
	el.setAttribute("spellcheck", "false");
	el.setAttribute("aria-label", "List name, edit to rename the file");
	el.setAttribute("contenteditable", always ? "plaintext-only" : "false");

	const setEditing = (next: boolean) => {
		if (editing === next) return;
		editing = next;
		el.toggleClass("is-editing", next && !always);
		if (!always) {
			el.setAttribute("contenteditable", next ? "plaintext-only" : "false");
		}
		opts.onEditing?.(next);
	};

	const stop = () => {
		if (always) return;
		setEditing(false);
	};

	const commit = () => {
		const next = (el.textContent ?? "").trim();
		stop();
		// An empty name would be an unopenable file, and an unchanged one is not
		// worth a rename — either way, put the original back and write nothing.
		if (!next || next === opts.value) {
			el.setText(shown());
			return;
		}
		opts.onCommit(next);
	};

	const cancel = () => {
		el.setText(shown());
		stop();
		el.blur();
	};

	// Focus is where the tidied title gives way to the real filename. It fires
	// for a click into an always-editable header as well as for `edit()`, which
	// is why it lives here rather than only in `edit`.
	el.addEventListener("focus", () => {
		if (el.textContent !== opts.value) el.setText(opts.value);
	});

	el.addEventListener("blur", () => {
		if (editing) commit();
		else if (el.textContent !== shown()) el.setText(shown());
	});

	el.addEventListener("keydown", (e) => {
		if (!editing) return;
		if (e.key === "Enter") {
			e.preventDefault();
			el.blur();
		}
		if (e.key === "Escape") {
			e.preventDefault();
			cancel();
		}
		// A row listens for Enter, space and the arrow keys. While the user is
		// typing a name, none of that should reach it.
		e.stopPropagation();
	});

	const edit = () => {
		setEditing(true);
		el.setText(opts.value);
		el.focus();
		selectAll(el);
	};

	if (!always) {
		// Editing is armed deliberately, never by the click that opens the list.
		el.addEventListener("dblclick", (e) => {
			e.preventDefault();
			e.stopPropagation();
			edit();
		});
		// A click while already editing places the caret; it must not also be
		// read by the row as "open this list".
		el.addEventListener("click", (e) => {
			if (editing) e.stopPropagation();
		});
		el.addEventListener("pointerdown", (e) => {
			if (editing) e.stopPropagation();
		});
	}

	return { edit };
}

/** Put the caret around the whole name, so typing replaces it. */
function selectAll(el: HTMLElement): void {
	const range = document.createRange();
	range.selectNodeContents(el);
	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(range);
}

/**
 * Put the caret in the always-editable name inside a header, with the whole
 * thing selected. For the Rename menu item, which has the header to hand rather
 * than the element.
 */
export function editName(header: HTMLElement): void {
	const el = header.querySelector<HTMLElement>(".lv-header-name");
	if (!el) return;
	el.focus();
	selectAll(el);
}
