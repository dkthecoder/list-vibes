import { setIcon } from "obsidian";
import { Task } from "../model/types";
import {
	PRIORITY_BY_STARS,
	STAR_PRIORITY,
	isStarred,
	starsOf,
} from "../model/sort";
import { DetailContext } from "../views/context";
import { centreOf, sparkleBurst } from "./burst";

/**
 * The importance control, in whichever mode the user picked.
 *
 * Both modes read and write the same priority field, so a task rated 4 stars
 * shows as a filled star in star mode and vice versa. Nothing is rewritten when
 * the setting changes.
 */
export function renderImportance(
	parent: HTMLElement,
	task: Task,
	ctx: DetailContext,
	opts: { size?: "sm" | "md" } = {}
): HTMLElement {
	return ctx.settings.importanceMode === "stars5"
		? renderRating(parent, task, ctx, opts)
		: renderStar(parent, task, ctx, opts);
}

/* ------------------------------------------------------------------ *
 * Single star
 * ------------------------------------------------------------------ */

function renderStar(
	parent: HTMLElement,
	task: Task,
	ctx: DetailContext,
	opts: { size?: "sm" | "md" }
): HTMLElement {
	const on = isStarred(task);
	const el = parent.createDiv({ cls: "lv-star lv-no-drag" });
	if (opts.size === "sm") el.addClass("is-sm");
	el.toggleClass("is-on", on);
	el.setAttribute("role", "button");
	el.setAttribute("tabindex", "0");
	el.setAttribute("aria-pressed", String(on));
	el.setAttribute("aria-label", on ? "Remove importance" : "Mark as important");
	setIcon(el, "star");

	const flip = (e: Event) => {
		e.stopPropagation();
		// Setting importance only. Clearing it is not a thing to celebrate.
		if (!on && ctx.settings.starBurst) sparkleBurst(centreOf(el));
		void ctx.mutator.setField(task, "priority", on ? null : STAR_PRIORITY);
	};
	el.addEventListener("click", flip);
	el.addEventListener("keydown", (e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			flip(e);
		}
	});
	return el;
}

/* ------------------------------------------------------------------ *
 * 1–5 rating
 * ------------------------------------------------------------------ */

function renderRating(
	parent: HTMLElement,
	task: Task,
	ctx: DetailContext,
	opts: { size?: "sm" | "md" }
): HTMLElement {
	const value = starsOf(task);
	const wrap = parent.createDiv({ cls: "lv-rating" });
	if (opts.size === "sm") wrap.addClass("is-sm");
	wrap.setAttribute("role", "radiogroup");
	wrap.setAttribute("aria-label", "Importance, 1 to 5 stars");

	// Hover preview without committing anything.
	let preview = 0;
	const paint = () => {
		const shown = preview || value;
		wrap.findAll(".lv-rating-star").forEach((s, i) => {
			s.toggleClass("is-on", i < shown);
			s.toggleClass("is-preview", preview > 0 && i < preview);
		});
	};

	for (let i = 1; i <= 5; i++) {
		const star = wrap.createDiv({ cls: "lv-rating-star" });
		star.setAttribute("role", "radio");
		star.setAttribute("tabindex", i === Math.max(value, 1) ? "0" : "-1");
		star.setAttribute("aria-checked", String(i === value));
		star.setAttribute("aria-label", `${i} star${i > 1 ? "s" : ""}`);
		setIcon(star, "star");

		const set = (e: Event) => {
			e.stopPropagation();
			// Tapping the current rating clears it, so 5 stars is reachable
			// and escapable without a separate clear button.
			const next = i === value ? 0 : i;
			if (next > 0 && ctx.settings.starBurst) sparkleBurst(centreOf(star));
			void ctx.mutator.setField(task, "priority", PRIORITY_BY_STARS[next] ?? null);
		};
		star.addEventListener("click", set);
		star.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				set(e);
			}
		});
		star.addEventListener("mouseenter", () => {
			preview = i;
			paint();
		});
	}

	wrap.addEventListener("mouseleave", () => {
		preview = 0;
		paint();
	});
	paint();
	return wrap;
}
