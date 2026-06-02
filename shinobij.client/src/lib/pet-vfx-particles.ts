/*
 * Pet-battle PARTICLE layer — a tiny, dependency-free <canvas> emitter that
 * sprays sparks / embers / shards / dust on the dramatic beats (impact, KO,
 * charge, status apply). It sits on top of the existing CSS VFX as an extra
 * layer of "juice"; the CSS flashes/projectiles stay untouched.
 *
 * Two halves:
 *   1. vfxBurstForEvent()  — PURE map from an animation event → a burst spec
 *      (kind / colors / count / physics). Node-testable, no canvas/DOM.
 *   2. PetParticleField    — an imperative canvas engine that plays bursts.
 *
 * IMPORTANT: the engine is COSMETIC ONLY. It is never read by the simulator
 * and never affects an outcome, so its use of Math.random for particle jitter
 * is safe even under ranked replay (two clients may show slightly different
 * sparks; the battle result is identical). Like the rest of the presentation
 * layer, this module must NOT import from ../App.
 */

import type { PetBattleAnimationEvent, PetVfxKey } from "../types/pet-battle";

// ── Pure burst spec ─────────────────────────────────────────────────────────

export type VfxBurstKind = "spark" | "ember" | "shard" | "arc" | "cloud" | "dust" | "none";

export type VfxBurstSpec = {
    kind: VfxBurstKind;
    /** Particle palette (a particle picks one at random). */
    colors: string[];
    /** How many particles to spawn. */
    count: number;
    /** Base outward speed in px/frame. */
    speed: number;
    /** Per-frame downward pull (px/frame²); negative rises (charge gather). */
    gravity: number;
    /** Particle lifetime in frames (~60fps). */
    life: number;
    /** Base radius in px. */
    size: number;
};

const NONE: VfxBurstSpec = { kind: "none", colors: [], count: 0, speed: 0, gravity: 0, life: 0, size: 0 };

// Element → particle palette. Mirrors the elemental VFX tints used elsewhere.
const PALETTES: Record<PetVfxKey, string[]> = {
    fire:      ["#fb923c", "#f87171", "#fde047", "#fff7ed"],
    water:     ["#38bdf8", "#7dd3fc", "#e0f2fe"],
    wind:      ["#a7f3d0", "#d1fae5", "#ffffff"],
    lightning: ["#fde047", "#fef08a", "#c4b5fd", "#ffffff"],
    earth:     ["#d6a45a", "#a16207", "#fde68a"],
    ice:       ["#bae6fd", "#e0f2fe", "#ffffff"],
    poison:    ["#c084fc", "#a855f7", "#86efac"],
    shadow:    ["#a78bfa", "#7c3aed", "#1e1b4b"],
    chakra:    ["#67e8f9", "#a5f3fc", "#ffffff"],
    blood:     ["#ef4444", "#b91c1c", "#fca5a5"],
    none:      ["#fde68a", "#fef3c7", "#ffffff"],
};

function paletteFor(vfx?: PetVfxKey): string[] {
    return PALETTES[vfx ?? "none"] ?? PALETTES.none;
}

/** The particle "kind" that best suits an element. */
function kindForElement(vfx?: PetVfxKey): VfxBurstKind {
    switch (vfx) {
        case "fire": return "ember";
        case "lightning": return "arc";
        case "ice": case "earth": return "shard";
        case "poison": case "shadow": return "cloud";
        default: return "spark";
    }
}

/**
 * Map a currently-playing animation event to a particle burst. Returns a
 * `none` spec for beats that shouldn't spray (idle, callouts, movement, etc.).
 * Pure — safe to unit test without a DOM.
 */
export function vfxBurstForEvent(
    event: Pick<PetBattleAnimationEvent, "type" | "vfxKey"> | undefined,
    opts: { crit?: boolean; isKO?: boolean } = {},
): VfxBurstSpec {
    if (!event) return NONE;
    const colors = paletteFor(event.vfxKey);
    const critMul = opts.crit ? 1.6 : 1;

    switch (event.type) {
        case "ko":
            return { kind: "spark", colors, count: 46, speed: 5.2, gravity: 0.16, life: 52, size: 3 };
        case "impact": {
            const base = opts.isKO ? 40 : opts.crit ? 30 : 18;
            return { kind: kindForElement(event.vfxKey), colors, count: Math.round(base * critMul), speed: opts.crit ? 4.4 : 3.2, gravity: 0.18, life: 40, size: opts.crit ? 3 : 2.4 };
        }
        case "statusApply":
            return { kind: kindForElement(event.vfxKey), colors, count: 14, speed: 1.7, gravity: 0.02, life: 46, size: 2.6 };
        case "charge":
            // Gather UP into the actor — negative gravity, slow rise.
            return { kind: "ember", colors, count: 22, speed: 1.4, gravity: -0.08, life: 50, size: 2.2 };
        default:
            return NONE;
    }
}

// ── Imperative canvas engine ────────────────────────────────────────────────

type Particle = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; color: string; shard: boolean };

const TWO_PI = Math.PI * 2;
const MAX_PARTICLES = 320; // hard cap so a flurry of bursts can't tank mobile

/**
 * A self-contained particle field bound to a <canvas>. Call burst() on a beat,
 * and it runs its own rAF loop only while particles are alive (idle = no work).
 * Handles devicePixelRatio for crisp dots and tears down cleanly on dispose().
 */
export class PetParticleField {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private particles: Particle[] = [];
    private raf = 0;
    private dpr = 1;
    private w = 0;
    private h = 0;
    private disposed = false;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("2d context unavailable");
        this.ctx = ctx;
        this.resize();
    }

    /** Match the backing store to the canvas's CSS box × devicePixelRatio. */
    resize(): void {
        const dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
        const rect = this.canvas.getBoundingClientRect();
        this.dpr = dpr;
        this.w = rect.width;
        this.h = rect.height;
        this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
        this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /** Spawn a burst's particles centered at (x, y) in CSS pixels. */
    burst(x: number, y: number, spec: VfxBurstSpec): void {
        if (this.disposed || spec.kind === "none" || spec.count <= 0) return;
        const room = MAX_PARTICLES - this.particles.length;
        const n = Math.max(0, Math.min(spec.count, room));
        for (let i = 0; i < n; i++) {
            const ang = Math.random() * TWO_PI;
            // Bias upward a touch so debris arcs rather than spilling flat.
            const spd = spec.speed * (0.45 + Math.random() * 0.75);
            const life = Math.round(spec.life * (0.7 + Math.random() * 0.6));
            this.particles.push({
                x, y,
                vx: Math.cos(ang) * spd,
                vy: Math.sin(ang) * spd - (spec.gravity >= 0 ? spec.speed * 0.35 : 0),
                life,
                maxLife: life,
                size: spec.size * (0.6 + Math.random() * 0.8),
                color: spec.colors[(Math.random() * spec.colors.length) | 0] ?? "#fff",
                shard: spec.kind === "shard" || spec.kind === "arc",
            });
        }
        this.ensureRunning(spec.gravity);
    }

    private ensureRunning(gravity: number): void {
        if (this.raf || this.disposed) return;
        const step = () => {
            this.raf = 0;
            if (this.disposed) return;
            const { ctx } = this;
            ctx.clearRect(0, 0, this.w, this.h);
            ctx.globalCompositeOperation = "lighter";
            const next: Particle[] = [];
            for (const p of this.particles) {
                p.life--;
                if (p.life <= 0) continue;
                p.x += p.vx;
                p.y += p.vy;
                p.vy += gravity;
                p.vx *= 0.98;
                const a = p.life / p.maxLife;
                ctx.globalAlpha = a;
                ctx.fillStyle = p.color;
                if (p.shard) {
                    const s = p.size * (0.6 + a);
                    ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
                } else {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.size * (0.4 + a), 0, TWO_PI);
                    ctx.fill();
                }
                next.push(p);
            }
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = "source-over";
            this.particles = next;
            if (next.length) this.raf = requestAnimationFrame(step);
        };
        this.raf = requestAnimationFrame(step);
    }

    /** Stop the loop and release everything. */
    dispose(): void {
        this.disposed = true;
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = 0;
        this.particles = [];
        if (this.w && this.h) this.ctx.clearRect(0, 0, this.w, this.h);
    }
}
