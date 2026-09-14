/**
 * Short particle bursts: confetti where a task was ticked, sparkles where a
 * star was set.
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
const SPARKS = 14;
const SPARK_LIFE = 550;
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
	shape: "chip" | "spark";
	life: number;
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
	const el = document.body.createEl("canvas", { cls: "lv-burst" });
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

	particles = particles.filter((p) => now - p.born < p.life);
	for (const p of particles) {
		const age = now - p.born;
		const x = p.x + p.vx * age;
		const y = p.y + p.vy * age + GRAVITY * age * age;
		ctx.save();
		ctx.globalAlpha = Math.max(0, 1 - age / p.life);
		ctx.translate(x * dpr, y * dpr);
		ctx.rotate(p.angle + p.spin * age);
		ctx.fillStyle = p.colour;
		if (p.shape === "chip") {
			ctx.fillRect((-p.size / 2) * dpr, (-p.size / 4) * dpr, p.size * dpr, (p.size / 2) * dpr);
		} else {
			// A four-point sparkle: two tapered spikes crossed, pinched at the
			// waist so it reads as a glint rather than a diamond.
			const r = p.size * dpr;
			ctx.beginPath();
			ctx.moveTo(0, -r);
			ctx.quadraticCurveTo(0, 0, r, 0);
			ctx.quadraticCurveTo(0, 0, 0, r);
			ctx.quadraticCurveTo(0, 0, -r, 0);
			ctx.quadraticCurveTo(0, 0, 0, -r);
			ctx.fill();
		}
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
			shape: "chip",
			life: LIFE,
		});
	}
	if (frame === null) frame = window.requestAnimationFrame(tick);
}

/** The centre of an element, for a burst thrown from the thing clicked. */
export function centreOf(el: HTMLElement): { x: number; y: number } {
	const r = el.getBoundingClientRect();
	return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * A tighter, quieter burst for the star: fewer particles, thrown outward
 * rather than up, in the accent the set star itself is drawn in.
 */
export function sparkleBurst(from: { x: number; y: number }): void {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	const accent = getComputedStyle(document.body)
		.getPropertyValue("--interactive-accent")
		.trim();
	if (!accent) return;

	const el = surface();
	const dpr = window.devicePixelRatio || 1;
	el.width = window.innerWidth * dpr;
	el.height = window.innerHeight * dpr;

	const now = performance.now();
	for (let i = 0; i < SPARKS; i++) {
		// Radiating rather than sprayed, but loosely: evenly spaced at one speed
		// draws a clock face, so both the angle and the reach are scattered.
		const angle = (i / SPARKS) * Math.PI * 2 + (Math.random() - 0.5) * 0.9;
		const power = 0.05 + Math.random() * 0.18;
		particles.push({
			x: from.x,
			y: from.y,
			vx: Math.cos(angle) * power,
			vy: Math.sin(angle) * power,
			spin: (Math.random() - 0.5) * 0.01,
			angle: Math.random() * Math.PI,
			size: 3 + Math.random() * 3,
			colour: accent,
			born: now,
			shape: "spark",
			life: SPARK_LIFE,
		});
	}
	if (frame === null) frame = window.requestAnimationFrame(tick);
}
