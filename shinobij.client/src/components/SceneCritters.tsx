/*
 * SceneCritters — characterful ambient wildlife on a single <canvas>, the layer
 * that makes a biome read as a place that's *alive* rather than a still picture:
 * birds gliding over the snow, butterflies wandering the meadow, dragonflies +
 * water ripples on the lagoon, ravens over the ash, and fireflies/spirit-wisps
 * after dark. The cast is chosen by biome AND the real time of day (see
 * lib/day-cycle.ts) so dusk trades butterflies for fireflies.
 *
 * Same discipline as <SceneAmbience>: one absolutely-positioned, pointer-events:
 * none canvas sized to its parent, a single rAF loop that pauses when the tab is
 * hidden, and a single static frame under prefers-reduced-motion. Pure canvas
 * shapes — $0, no assets, deterministic-free decoration that never touches game
 * state, balance, or saves.
 *
 *   <div style={{ position:'relative' }}>
 *     ...backdrop...
 *     <SceneCritters biome={biome} />
 *   </div>
 */
import { useEffect, useRef } from "react";
import type { Biome } from "../types/core";
import { skyNow } from "../lib/day-cycle";
import { isLowEndMobile } from "../lib/device-tier";

type Behavior = "glide" | "flutter" | "glow" | "dart" | "ripple";

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]) => arr[(Math.random() * arr.length) | 0];

interface Recipe {
    behavior: Behavior;
    /** base count at density 1 on a ~1000px-wide canvas */
    count: number;
    colors: string[];
    size: [number, number];
    /** vertical band of the scene it lives in, as fractions of height */
    band: [number, number];
    speed?: [number, number];
    glow?: boolean;
}

// The full cast. Biomes pick a subset for day vs night below.
const RECIPES: Record<string, Recipe> = {
    bird:      { behavior: "glide",  count: 3, colors: ["#27313f", "#1d2530", "#39434f"], size: [7, 12],  band: [0.06, 0.42], speed: [38, 74] },
    raven:     { behavior: "glide",  count: 3, colors: ["#0f1217", "#1a1f29"],            size: [8, 13],  band: [0.08, 0.46], speed: [46, 86] },
    butterfly: { behavior: "flutter",count: 5, colors: ["#f9a8d4", "#fcd34d", "#a5f3fc", "#c084fc", "#fb923c"], size: [4, 7], band: [0.44, 0.9] },
    moth:      { behavior: "flutter",count: 4, colors: ["#fde68a", "#fca5a5", "#fdba74"], size: [3.5, 6], band: [0.4, 0.9] },
    dragonfly: { behavior: "dart",   count: 4, colors: ["#67e8f9", "#5eead4", "#a7f3d0"], size: [5, 8],   band: [0.58, 0.9], speed: [70, 130] },
    firefly:   { behavior: "glow",   count: 24, colors: ["#fff7a8", "#eaff9b", "#fde68a"], size: [1.4, 3], band: [0.22, 0.95], glow: true },
    spirit:    { behavior: "glow",   count: 8, colors: ["#bfe0ff", "#d8c8ff", "#cfe8ff"],  size: [2, 4],   band: [0.3, 0.95], glow: true },
    ripple:    { behavior: "ripple", count: 3, colors: ["rgba(255,255,255,0.5)"],          size: [10, 26], band: [0.7, 0.94] },
};

// Biome → which critters are out, split by time of day. Kept tasteful: a couple
// of flyers + the signature critter, not a swarm.
function castFor(biome: Biome, night: boolean, mode: "scene" | "world"): string[] {
    if (mode === "world") return night ? ["bird"] : ["bird", "bird"]; // a high, sparse flock only
    if (night) {
        switch (biome) {
            case "snow":    return ["spirit"];
            case "volcano": return ["raven", "moth"];
            case "shadow":  return ["firefly", "spirit"];
            case "forest":  return ["firefly"];
            case "central": return ["firefly"];
            default:        return ["firefly"];
        }
    }
    switch (biome) {
        case "snow":    return ["bird"];
        case "volcano": return ["raven"];
        case "shadow":  return ["butterfly", "bird"]; // cherry-blossom temple
        case "forest":  return ["butterfly", "bird"];
        case "central": return ["bird", "dragonfly", "ripple"]; // lagoon/meadow life
        default:        return ["bird", "butterfly"];
    }
}

interface C {
    kind: string;
    behavior: Behavior;
    x: number; y: number;
    vx: number; vy: number;
    baseY: number; ampY: number;
    size: number; color: string;
    phase: number; flap: number; flapSpeed: number;
    blink: number; blinkSpeed: number; alpha: number;
    dir: number;              // facing for flyers
    life: number; maxLife: number; // ripples
    wanderA: number; wanderB: number;
}

export function SceneCritters({
    biome,
    density = 1,
    mode = "scene",
    className,
}: {
    biome: Biome;
    /** scales critter counts (0–1.5). Lower behind menus / on cramped panels. */
    density?: number;
    /** "world" = a sparse high flock only (overworld); "scene" = full biome cast. */
    mode?: "scene" | "world";
    className?: string;
}) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        // Weak phones: ~60% fewer critters, no firefly/spirit glow (shadowBlur is the
        // expensive part), and a 1x backing store (skip the HiDPI fill). Cosmetic —
        // the biome still has a little life.
        const lowEnd = isLowEndMobile();
        const effDensity = density * (lowEnd ? 0.4 : 1);
        const maxDpr = lowEnd ? 1 : 2;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        let w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
        let crits: C[] = [];
        let raf = 0, last = 0, running = true;
        let night = skyNow(new Date()).night > 0.5;
        const parent = canvas.parentElement;

        function makeOne(kind: string): C {
            const r = RECIPES[kind];
            const band: [number, number] = r.band;
            const baseY = rand(band[0], band[1]) * h;
            const dir = Math.random() < 0.5 ? -1 : 1;
            const sp = r.speed ? rand(r.speed[0], r.speed[1]) : 0;
            return {
                kind, behavior: r.behavior,
                x: rand(0, w), y: baseY,
                vx: dir * sp, vy: 0,
                baseY, ampY: rand(6, 22),
                size: rand(r.size[0], r.size[1]),
                color: pick(r.colors),
                phase: rand(0, Math.PI * 2),
                flap: rand(0, Math.PI * 2),
                flapSpeed: r.behavior === "glide" ? rand(6, 10) : r.behavior === "dart" ? rand(22, 34) : rand(7, 12),
                blink: rand(0, Math.PI * 2),
                blinkSpeed: rand(1.4, 3.2),
                alpha: rand(0.5, 0.95),
                dir,
                life: rand(0, 1), maxLife: rand(2.2, 4),
                wanderA: rand(0.3, 0.8), wanderB: rand(0.5, 1.3),
            };
        }

        function spawn() {
            crits = [];
            if (!w || !h) return;
            const cast = castFor(biome, night, mode);
            const widthScale = Math.max(0.5, w / 1000);
            for (const kind of cast) {
                const r = RECIPES[kind];
                const n = Math.max(1, Math.round(r.count * widthScale * effDensity));
                for (let i = 0; i < n; i++) crits.push(makeOne(kind));
            }
        }

        function resize() {
            if (!parent) return;
            const rect = parent.getBoundingClientRect();
            w = rect.width; h = rect.height;
            dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
            canvas!.width = Math.max(1, Math.round(w * dpr));
            canvas!.height = Math.max(1, Math.round(h * dpr));
            canvas!.style.width = w + "px";
            canvas!.style.height = h + "px";
            ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
            spawn();
        }

        // ── draw helpers ─────────────────────────────────────────────────
        function drawBird(p: C) {
            const a = (Math.sin(p.flap) + 1) / 2;           // 0..1 wingbeat
            const wing = p.size;
            const dip = wing * (0.18 + a * 0.55);
            ctx!.strokeStyle = p.color;
            ctx!.lineWidth = Math.max(1.1, p.size * 0.17);
            ctx!.lineCap = "round";
            ctx!.beginPath();
            ctx!.moveTo(p.x - wing, p.y + dip);
            ctx!.quadraticCurveTo(p.x, p.y - dip * 0.5, p.x, p.y);
            ctx!.quadraticCurveTo(p.x, p.y - dip * 0.5, p.x + wing, p.y + dip);
            ctx!.stroke();
        }

        function drawButterfly(p: C) {
            const flap = Math.abs(Math.sin(p.flap));        // 0..1 wings open/closed
            const ww = p.size * (0.32 + 0.68 * flap);
            const tilt = Math.atan2(p.vy, p.vx || p.dir);
            ctx!.save();
            ctx!.translate(p.x, p.y);
            ctx!.rotate(tilt);
            ctx!.fillStyle = p.color;
            ctx!.globalAlpha = p.alpha;
            // four wings
            for (const sx of [-1, 1]) {
                ctx!.beginPath();
                ctx!.ellipse(sx * p.size * 0.5, -p.size * 0.35, ww, p.size * 0.7, 0, 0, Math.PI * 2);
                ctx!.fill();
                ctx!.beginPath();
                ctx!.ellipse(sx * p.size * 0.45, p.size * 0.4, ww * 0.8, p.size * 0.55, 0, 0, Math.PI * 2);
                ctx!.fill();
            }
            // body
            ctx!.fillStyle = "rgba(20,20,28,0.85)";
            ctx!.beginPath();
            ctx!.ellipse(0, 0, p.size * 0.16, p.size * 0.95, 0, 0, Math.PI * 2);
            ctx!.fill();
            ctx!.restore();
        }

        function drawDragonfly(p: C) {
            const flap = Math.abs(Math.sin(p.flap));
            ctx!.save();
            ctx!.translate(p.x, p.y);
            ctx!.rotate(p.dir < 0 ? Math.PI : 0);
            ctx!.globalAlpha = p.alpha * 0.85;
            // gossamer wings
            ctx!.fillStyle = "rgba(255,255,255,0.45)";
            for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
                ctx!.beginPath();
                ctx!.ellipse(sx * p.size * 0.2, sy * p.size * (0.18 + flap * 0.25), p.size * 0.7, p.size * 0.16, sx * 0.5, 0, Math.PI * 2);
                ctx!.fill();
            }
            // slender body
            ctx!.strokeStyle = p.color;
            ctx!.lineWidth = Math.max(1, p.size * 0.22);
            ctx!.beginPath();
            ctx!.moveTo(-p.size * 0.9, 0);
            ctx!.lineTo(p.size * 1.1, 0);
            ctx!.stroke();
            ctx!.restore();
        }

        function drawGlow(p: C) {
            // pulse + occasional blink-off (fireflies)
            const pulse = 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(p.blink));
            const blinkOff = p.kind === "firefly" ? Math.max(0, Math.sin(p.blink * 0.37)) : 1;
            ctx!.globalAlpha = p.alpha * pulse * (0.35 + 0.65 * blinkOff);
            ctx!.fillStyle = p.color;
            ctx!.shadowBlur = lowEnd ? 0 : p.size * 4;
            ctx!.shadowColor = p.color;
            ctx!.beginPath();
            ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx!.fill();
            ctx!.shadowBlur = 0;
        }

        function drawRipple(p: C) {
            const t = p.life / p.maxLife;        // 0..1
            const radius = p.size * (0.3 + t);
            ctx!.globalAlpha = (1 - t) * 0.5;
            ctx!.strokeStyle = "rgba(220,240,255,0.8)";
            ctx!.lineWidth = 1.2;
            ctx!.beginPath();
            ctx!.ellipse(p.x, p.y, radius, radius * 0.42, 0, 0, Math.PI * 2);
            ctx!.stroke();
        }

        function step(p: C, dt: number) {
            p.flap += p.flapSpeed * dt;
            p.blink += p.blinkSpeed * dt;
            p.phase += dt;
            switch (p.behavior) {
                case "glide": {
                    p.x += p.vx * dt;
                    p.y = p.baseY + Math.sin(p.phase * 0.8) * p.ampY;
                    if (p.vx > 0 && p.x - p.size > w + 40) { p.x = -40; p.baseY = rand(RECIPES[p.kind].band[0], RECIPES[p.kind].band[1]) * h; }
                    else if (p.vx < 0 && p.x + p.size < -40) { p.x = w + 40; p.baseY = rand(RECIPES[p.kind].band[0], RECIPES[p.kind].band[1]) * h; }
                    break;
                }
                case "dart": {
                    // quick darts with pauses — erratic dragonfly motion
                    const burst = Math.sin(p.phase * 1.7) > 0.2 ? 1 : 0.12;
                    p.x += p.vx * burst * dt;
                    p.y = p.baseY + Math.sin(p.phase * 2.1) * p.ampY * 0.8;
                    if (p.x > w + 30) { p.x = -30; p.dir = 1; p.vx = Math.abs(p.vx); p.baseY = rand(RECIPES[p.kind].band[0], RECIPES[p.kind].band[1]) * h; }
                    else if (p.x < -30) { p.x = w + 30; p.dir = -1; p.vx = -Math.abs(p.vx); p.baseY = rand(RECIPES[p.kind].band[0], RECIPES[p.kind].band[1]) * h; }
                    break;
                }
                case "flutter": {
                    // meander via two summed sines → soft random-walk
                    p.vx = Math.cos(p.phase * p.wanderA) * 26 + Math.cos(p.phase * 1.7) * 10;
                    p.vy = Math.sin(p.phase * p.wanderB) * 18 + Math.sin(p.phase * 2.3) * 8;
                    p.x += p.vx * dt;
                    p.y += p.vy * dt;
                    p.dir = p.vx < 0 ? -1 : 1;
                    if (p.x < -30) p.x = w + 30; else if (p.x > w + 30) p.x = -30;
                    if (p.y < h * 0.4) p.y = h * 0.4; else if (p.y > h * 0.95) p.y = h * 0.95;
                    break;
                }
                case "glow": {
                    p.vx = Math.cos(p.phase * 0.6 + p.flap) * 12;
                    p.vy = Math.sin(p.phase * 0.5) * 9;
                    p.x += p.vx * dt;
                    p.y += p.vy * dt;
                    if (p.x < -20) p.x = w + 20; else if (p.x > w + 20) p.x = -20;
                    if (p.y < h * 0.18) p.y = h * 0.18; else if (p.y > h * 0.97) p.y = h * 0.97;
                    break;
                }
                case "ripple": {
                    p.life += dt;
                    if (p.life >= p.maxLife) { p.life = 0; p.x = rand(0.1, 0.9) * w; p.baseY = rand(0.7, 0.94) * h; p.y = p.baseY; p.maxLife = rand(2.2, 4.2); p.size = rand(10, 28); }
                    break;
                }
            }
        }

        function render(p: C) {
            ctx!.globalAlpha = 1;
            switch (p.kind) {
                case "butterfly":
                case "moth": drawButterfly(p); break;
                case "dragonfly": drawDragonfly(p); break;
                case "firefly":
                case "spirit": drawGlow(p); break;
                case "ripple": drawRipple(p); break;
                default: drawBird(p); break;
            }
            ctx!.globalAlpha = 1;
        }

        function frame(t: number) {
            if (!running) return;
            const dt = Math.min(0.05, last ? (t - last) / 1000 : 0.016);
            last = t;
            ctx!.clearRect(0, 0, w, h);
            for (const p of crits) { step(p, dt); render(p); }
            raf = requestAnimationFrame(frame);
        }

        const ro = new ResizeObserver(resize);
        if (parent) ro.observe(parent);
        resize();

        if (reduce) {
            running = false;
            ctx.clearRect(0, 0, w, h);
            for (const p of crits) render(p);
        } else {
            raf = requestAnimationFrame(frame);
        }

        // Re-evaluate the day/night cast every few minutes (dusk swaps the cast).
        const dayTimer = window.setInterval(() => {
            const n = skyNow(new Date()).night > 0.5;
            if (n !== night) { night = n; spawn(); }
        }, 120_000);

        function onVis() {
            if (reduce) return;
            if (document.hidden) { running = false; cancelAnimationFrame(raf); }
            else if (!running) { running = true; last = 0; raf = requestAnimationFrame(frame); }
        }
        document.addEventListener("visibilitychange", onVis);

        return () => {
            running = false;
            cancelAnimationFrame(raf);
            ro.disconnect();
            window.clearInterval(dayTimer);
            document.removeEventListener("visibilitychange", onVis);
        };
    }, [biome, density, mode]);

    return (
        <div className={"scene-critters" + (className ? " " + className : "")} aria-hidden="true">
            <canvas ref={canvasRef} className="scene-critters-canvas" />
        </div>
    );
}
