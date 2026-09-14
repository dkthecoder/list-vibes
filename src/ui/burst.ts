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
 * - **The colour is the list's.** `--lv-accent` is read off the element that
 *   was clicked — custom properties inherit, so a list with `color:` in its
 *   frontmatter throws its own colour and an uncoloured one throws the
 *   accent from Obsidian's appearance settings. Nothing is written down here,
 *   so the palette audit stays true when it says no colour in this plugin is
 *   its own.
 * - **Reduced motion means none.** Not fewer, not slower.
 */

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
	/** Varied per particle, so one colour still reads as a crowd. */
	alpha: number;
}

let canvas: HTMLCanvasElement | null = null;
let particles: Particle[] = [];
let frame: number | null = null;

/**
 * The colour of the list the element belongs to, or the theme's accent where
 * there is no list. Empty means no burst rather than a colour of our own.
 */
function accentOf(el: HTMLElement): string {
	const cs = getComputedStyle(el);
	return (
		cs.getPropertyValue("--lv-accent").trim() ||
		cs.getPropertyValue("--interactive-accent").trim()
	);
}

/** The centre of an element, for a burst thrown from the thing clicked. */
function centre(el: HTMLElement): { x: number; y: number } {
	const r = el.getBoundingClientRect();
	return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
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
		ctx.globalAlpha = Math.max(0, 1 - age / p.life) * p.alpha;
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
export function confettiBurst(source: HTMLElement): void {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	const colour = accentOf(source);
	if (!colour) return;
	const from = centre(source);

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
			colour,
			born: now,
			shape: "chip",
			life: LIFE,
			alpha: 0.55 + Math.random() * 0.45,
		});
	}
	if (frame === null) frame = window.requestAnimationFrame(tick);
}


/**
 * A tighter, quieter burst for the star: fewer particles, thrown outward
 * rather than up, in the accent the set star itself is drawn in.
 */
export function sparkleBurst(source: HTMLElement): void {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	const accent = accentOf(source);
	if (!accent) return;
	const from = centre(source);

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
			alpha: 0.6 + Math.random() * 0.4,
		});
	}
	if (frame === null) frame = window.requestAnimationFrame(tick);
}
