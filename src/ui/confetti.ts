/**
 * A short burst of confetti where a task was ticked.
 *
 * Three things decide the shape of this:
 *
 * - **It outlives the repaint.** Completing a task rewrites the file, which
 *   comes back as a vault event and repaints the pane, so the row that was
 *   clicked is gone within about 30ms. The canvas therefore hangs off
 *   `document.body`, outside everything this plugin redraws.
 * - **The colours are the theme's.** Obsidian's own colour scale is read at
 *   run time rather than written down here, so the burst matches whatever
 *   theme is loaded — and the palette audit stays true when it says no colour
 *   in this plugin is its own.
 * - **Reduced motion means none.** Not fewer, not slower.
 */

/** Obsidian's colour scale. Absent ones are skipped, not substituted. */
const TOKENS = [
	"--color-red",
	"--color-orange",
	"--color-yellow",
	"--color-green",
	"--color-cyan",
	"--color-blue",
	"--color-purple",
	"--color-pink",
];

const COUNT = 36;
const LIFE = 900;
const GRAVITY = 0.0015;

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	spin: number;
	angle: number;
	size: number;
	colour: string;
	born: number;
}

let canvas: HTMLCanvasElement | null = null;
let particles: Particle[] = [];
let frame: number | null = null;

function palette(): string[] {
	const cs = getComputedStyle(document.body);
	const scale = TOKENS.map((t) => cs.getPropertyValue(t).trim()).filter(Boolean);
	if (scale.length) return scale;
	// A theme with no colour scale still has an accent; with neither, no burst.
	const accent = cs.getPropertyValue("--interactive-accent").trim();
	return accent ? [accent] : [];
}

function surface(): HTMLCanvasElement {
	if (canvas) return canvas;
	const el = document.body.createEl("canvas", { cls: "lv-confetti" });
	canvas = el;
	return el;
}

function tick(): void {
	frame = null;
	const el = canvas;
	const ctx = el?.getContext("2d");
	if (!el || !ctx) return stop();

	const now = performance.now();
	ctx.clearRect(0, 0, el.width, el.height);
	const dpr = window.devicePixelRatio || 1;

	particles = particles.filter((p) => now - p.born < LIFE);
	for (const p of particles) {
		const age = now - p.born;
		const x = p.x + p.vx * age;
		const y = p.y + p.vy * age + GRAVITY * age * age;
		ctx.save();
		ctx.globalAlpha = Math.max(0, 1 - age / LIFE);
		ctx.translate(x * dpr, y * dpr);
		ctx.rotate(p.angle + p.spin * age);
		ctx.fillStyle = p.colour;
		ctx.fillRect((-p.size / 2) * dpr, (-p.size / 4) * dpr, p.size * dpr, (p.size / 2) * dpr);
		ctx.restore();
	}

	if (particles.length) frame = window.requestAnimationFrame(tick);
	else stop();
}

/** Remove the canvas and forget everything, e.g. when the plugin unloads. */
export function stopConfetti(): void {
	if (frame !== null) window.cancelAnimationFrame(frame);
	frame = null;
	particles = [];
	canvas?.remove();
	canvas = null;
}

const stop = stopConfetti;

/**
 * Throw a burst from a point on screen, usually a checkbox that was just
 * ticked. Silently does nothing when motion is not wanted.
 */
export function confettiBurst(from: { x: number; y: number }): void {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	const colours = palette();
	if (!colours.length) return;

	const el = surface();
	const dpr = window.devicePixelRatio || 1;
	el.width = window.innerWidth * dpr;
	el.height = window.innerHeight * dpr;

	const now = performance.now();
	for (let i = 0; i < COUNT; i++) {
		// Upward and outward: a spray from the tick, not an explosion around it.
		const spread = (Math.random() - 0.5) * 1.8;
		const power = 0.25 + Math.random() * 0.35;
		particles.push({
			x: from.x,
			y: from.y,
			vx: spread * power,
			vy: -(0.45 + Math.random() * 0.5) * power * 2,
			spin: (Math.random() - 0.5) * 0.02,
			angle: Math.random() * Math.PI,
			size: 5 + Math.random() * 5,
			colour: colours[i % colours.length],
			born: now,
		});
	}
	if (frame === null) frame = window.requestAnimationFrame(tick);
}

/** The centre of an element, for a burst thrown from the thing clicked. */
export function centreOf(el: HTMLElement): { x: number; y: number } {
	const r = el.getBoundingClientRect();
	return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
