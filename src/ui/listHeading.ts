import { setIcon } from "obsidian";
import { makeEditableName } from "./editableName";

/**
 * The band that titles a run of tasks.
 *
 * There are three of them — a group, Completed, and the starred band — and they
 * were three separate class trees drawn three separate ways. They drifted, as
 * parallel trees do: Completed never picked up the leading column the rows and
 * the group headings share, so its label sat ten pixels off the rail every
 * other line in the pane starts on.
 *
 * One band, then, with its parts switched on per caller. What a heading *can
 * do* differs — only a group has a line in the file to rename — but what it
 * looks like should not, and now cannot.
 */
export interface HeadingSpec {
	label: string;
	/** Omitted rather than zero when there is nothing to count. */
	count?: number;
	/** Marker class for the callers that need addressing separately. */
	modifier?: string;
	/** A fold control, and what clicking the band does. */
	fold?: { open: boolean; onToggle: () => void };
	/** Rename in place. Only a group has a heading line to rewrite. */
	onRename?: (next: string) => void;
	/** The ⋯ menu. */
	onMenu?: (e: MouseEvent) => void;
}

export function renderHeading(parent: HTMLElement, spec: HeadingSpec): HTMLElement {
	const head = parent.createDiv({ cls: "lv-section" });
	if (spec.modifier) head.addClass(spec.modifier);

	if (spec.fold) {
		/*
		 * A band that folds is a button, and was only one where it had been
		 * written out by hand. Keyboards reached Completed and not a group.
		 */
		head.addClass("is-foldable");
		head.toggleClass("is-collapsed", !spec.fold.open);
		head.setAttribute("tabindex", "0");
		head.setAttribute("role", "button");
		head.setAttribute("aria-expanded", String(spec.fold.open));

		const chev = head.createDiv({ cls: "lv-section-chevron" });
		setIcon(chev, spec.fold.open ? "chevron-down" : "chevron-right");
	}

	const name = head.createDiv({ cls: "lv-section-name", text: spec.label });
	if (spec.onRename) {
		makeEditableName(name, { value: spec.label, onCommit: spec.onRename });
	}

	if (spec.count !== undefined) {
		head.createDiv({ cls: "lv-section-count", text: String(spec.count) });
	}

	if (spec.onMenu) {
		const more = head.createDiv({ cls: "clickable-icon lv-section-more" });
		setIcon(more, "more-horizontal");
		more.setAttribute("aria-label", "Group options");
		more.addEventListener("click", (e) => {
			e.stopPropagation();
			spec.onMenu?.(e);
		});
	}

	const fold = spec.fold;
	if (fold) {
		head.addEventListener("click", () => fold.onToggle());
		head.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				fold.onToggle();
			}
		});
	}

	return head;
}
