/*
 * SceneAmbience — a lightweight, self-contained 2D "liveness" overlay that
 * makes a scene feel alive: drifting biome particles (snow / embers / petals /
 * leaves / light motes), optional weather (rain, ashfall, haze, lightning) and
 * a slow god-ray sweep + vignette for depth.
 *
 * It is pure decoration: one absolutely-positioned <canvas> (pointer-events:none)
 * sized to its parent, plus a couple of CSS overlay divs. It keys entirely off
 * `biome` + optional `weather`, runs a single requestAnimationFrame loop, pauses
 * when the tab is hidden, and fully disables motion under prefers-reduced-motion.
 *
 * Drop it inside any `position:relative` container (sector view, world map,
 * village, battle backdrop):
 *
 *   <div style={{ position:'relative' }}>
 *     ...background...
 *     <SceneAmbience biome={biome} weather={weather} />
 *   </div>
 */
import { useEffect, useMemo, useRef } from "react";
import type { Biome, WeatherType } from "../types/core";
import { isLowEndMobile } from "../lib/device-tier";

type Kind = "snow" | "ember" | "petal" | "leaf" | "mote" | "rain" | "ash" | "haze";

interface KindCfg {
    /** base count at intensity 1 on a ~1000px-wide canvas */
    count: number;
    color: () => string;
    /** size range in px */
    size: [number, number];
    /** vertical velocity px/s (positive = down) */
    vy: [number, number];
    /** horizontal drift amplitude px/s */
    drift: number;
    /** sway frequency */
    sway: number;
    /** rotates (petals/leaves) */
    spin?: boolean;
    /** glow (embers/motes) */
    glow?: boolean;
    /** streak (rain) */
    streak?: number;
    /** base opacity */
    alpha: [number, number];
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]) => arr[(Math.random() * arr.length) | 0];

const KINDS: Record<Kind, KindCfg> = {
    snow:  { count: 70,  color: () => "rgba(255,255,255,1)",                      size: [1.4, 3.6], vy: [22, 55],  drift: 26, sway: 1.1, alpha: [.5, .95] },
    ember: { count: 46,  color: () => pick(["#ffd27a", "#ff9d3d", "#ff6a2b"]),    size: [1.2, 3.2], vy: [-58, -26], drift: 22, sway: 1.6, glow: true, alpha: [.4, .95] },
    petal: { count: 40,  color: () => pick(["#f9a8d4", "#e879f9", "#c084fc"]),    size: [3, 6.5],   vy: [16, 40],  drift: 34, sway: 0.8, spin: true, alpha: [.55, .95] },
    leaf:  { count: 30,  color: () => pick(["#86efac", "#4ade80", "#fde047", "#a3e635"]), size: [3.5, 7], vy: [18, 42], drift: 38, sway: 0.7, spin: true, alpha: [.55, .95] },
    mote:  { count: 50,  color: () => pick(["#fff7cc", "#ffe8a3", "#fffaf0"]),    size: [1, 2.8],   vy: [-14, 10], drift: 16, sway: 0.5, glow: true, alpha: [.25, .8] },
    rain:  { count: 130, color: () => "rgba(190,220,255,0.65)",                   size: [0.8, 1.4], vy: [380, 620], drift: 6,  sway: 0,   streak: 14, alpha: [.3, .65] },
    ash:   { count: 70,  color: () => pick(["#9ca3af", "#6b7280", "#d1d5db"]),    size: [1.2, 3],   vy: [20, 46],  drift: 20, sway: 1.0, alpha: [.35, .8] },
    haze:  { count: 26,  color: () => pick(["#e7c98a", "#d9b873", "#f0dca0"]),    size: [40, 120],  vy: [-4, 4],   drift: 30, sway: 0.3, alpha: [.05, .14] },
};

/** Map a biome (+ weather) to the particle kinds that should be active. */
function kindsFor(biome: Biome, weather?: WeatherType): Kind[] {
    const base: Record<Biome, Kind> = {
        snow: "snow",
        volcano: "ember",
        shadow: "petal",
        forest: "leaf",
        central: "mote",
    };
    const list: Kind[] = [base[biome] ?? "mote"];
    switch (weather) {
        case "rain": list.push("rain"); break;
        case "thunderstorm": list.push("rain"); break;
        case "ashfall": if (biome !== "volcano") list.push("ash"); break;
        case "desertHaze": list.push("haze"); break;
        case "tornado": list.push("haze"); break;
        default: break;
    }
    return [...new Set(list)];
}

interface P {
    kind: Kind; x: number; y: number; vy: number; size: number;
    color: string; alpha: number; phase: number; swayAmp: number; spin: number; rot: number;
}

export function SceneAmbience({
    biome,
    weather,
    intensity = 1,
    className,
}: {
    biome: Biome;
    weather?: WeatherType;
    /** scales particle count (0–1.5). Lower on cramped panels. */
    intensity?: number;
    className?: string;
}) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const kinds = useMemo(() => kindsFor(biome, weather), [biome, weather]);
    const lightning = weather === "thunderstorm";

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        // Weak phones: ~60% fewer particles, no per-particle glow (shadowBlur is the
        // expensive part), and a 1x backing store (skip the HiDPI fill). Cosmetic —
        // the scene still drifts, just lighter.
        const lowEnd = isLowEndMobile();
        const effIntensity = intensity * (lowEnd ? 0.4 : 1);
        const maxDpr = lowEnd ? 1 : 2;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        let w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
        let particles: P[] = [];
        let raf = 0;
        let last = 0;
        let running = true;
        // Thunderstorm lightning state (procedural bolt + synced flash, all on-canvas).
        let boltCooldown = rand(1.0, 3.0);
        let flash = 0;
        let bolt: { pts: { x: number; y: number }[]; branches: { x: number; y: number }[][]; t: number; dur: number } | null = null;

        const parent = canvas.parentElement;

        function spawn() {
            particles = [];
            if (w === 0 || h === 0) return;
            const widthScale = Math.max(0.5, w / 1000);
            for (const kind of kinds) {
                const cfg = KINDS[kind];
                // Heavier rain during a thunderstorm so the bolts land in real weather.
                const stormFactor = (kind === "rain" && lightning) ? 1.4 : 1;
                const n = Math.round(cfg.count * widthScale * effIntensity * stormFactor);
                for (let i = 0; i < n; i++) {
                    const c = cfg;
                    particles.push({
                        kind,
                        x: rand(0, w),
                        y: rand(0, h),
                        vy: rand(c.vy[0], c.vy[1]),
                        size: rand(c.size[0], c.size[1]),
                        color: c.color(),
                        alpha: rand(c.alpha[0], c.alpha[1]),
                        phase: rand(0, Math.PI * 2),
                        swayAmp: c.drift * rand(0.5, 1),
                        spin: c.spin ? rand(-2, 2) : 0,
                        rot: rand(0, Math.PI * 2),
                    });
                }
            }
        }

        function resize() {
            if (!parent) return;
            const r = parent.getBoundingClientRect();
            w = r.width; h = r.height;
            dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
            canvas!.width = Math.max(1, Math.round(w * dpr));
            canvas!.height = Math.max(1, Math.round(h * dpr));
            canvas!.style.width = w + "px";
            canvas!.style.height = h + "px";
            ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
            spawn();
        }

        // Build a jagged top-to-ground lightning bolt with the odd forking branch.
        function makeBolt() {
            const startX = rand(w * 0.15, w * 0.85);
            const pts: { x: number; y: number }[] = [{ x: startX, y: -10 }];
            let x = startX, y = 0;
            const segH = Math.max(16, h / rand(10, 16));
            while (y < h) {
                y += segH * rand(0.7, 1.3);
                x = Math.max(4, Math.min(w - 4, x + rand(-w * 0.06, w * 0.06)));
                pts.push({ x, y });
            }
            const branches: { x: number; y: number }[][] = [];
            const nb = (Math.random() < 0.75 ? 1 : 0) + (Math.random() < 0.3 ? 1 : 0);
            for (let b = 0; b < nb && pts.length > 4; b++) {
                const i = 2 + ((Math.random() * (pts.length - 3)) | 0);
                let bx = pts[i].x, by = pts[i].y;
                const bp: { x: number; y: number }[] = [{ x: bx, y: by }];
                const steps = 3 + ((Math.random() * 4) | 0);
                const dir = bx > startX ? 1 : -1;
                for (let s = 0; s < steps; s++) {
                    by += segH * rand(0.5, 1.0);
                    bx += rand(-w * 0.05, w * 0.05) + dir * w * 0.02;
                    bp.push({ x: bx, y: by });
                }
                branches.push(bp);
            }
            return { pts, branches, t: 0, dur: rand(0.18, 0.34) };
        }

        // Stroke a bolt path: soft blue glow underlay + bright white core.
        function strokeBolt(pts: { x: number; y: number }[], coreW: number, glowW: number, alpha: number) {
            if (pts.length < 2) return;
            ctx!.beginPath();
            ctx!.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx!.lineTo(pts[i].x, pts[i].y);
            if (!lowEnd && glowW > 0) { ctx!.shadowBlur = glowW; ctx!.shadowColor = "rgba(150,190,255,0.9)"; }
            ctx!.strokeStyle = `rgba(190,215,255,${0.5 * alpha})`;
            ctx!.lineWidth = coreW + 3;
            ctx!.stroke();
            ctx!.shadowBlur = 0;
            ctx!.strokeStyle = `rgba(255,255,255,${0.95 * alpha})`;
            ctx!.lineWidth = coreW;
            ctx!.stroke();
        }

        function draw(t: number) {
            if (!running) return;
            const dt = Math.min(0.05, last ? (t - last) / 1000 : 0.016);
            last = t;
            ctx!.clearRect(0, 0, w, h);
            for (const p of particles) {
                const cfg = KINDS[p.kind];
                p.y += p.vy * dt;
                p.phase += cfg.sway * dt;
                p.x += Math.cos(p.phase) * p.swayAmp * dt;
                if (p.spin) p.rot += p.spin * dt;
                // wrap
                if (p.vy > 0 && p.y - p.size > h) { p.y = -p.size; p.x = rand(0, w); }
                else if (p.vy < 0 && p.y + p.size < 0) { p.y = h + p.size; p.x = rand(0, w); }
                if (p.x < -60) p.x = w + 60; else if (p.x > w + 60) p.x = -60;

                ctx!.globalAlpha = p.alpha;
                ctx!.fillStyle = p.color;
                if (cfg.glow && !lowEnd) { ctx!.shadowBlur = p.size * 3; ctx!.shadowColor = p.color; } else ctx!.shadowBlur = 0;

                if (cfg.streak) {
                    ctx!.strokeStyle = p.color;
                    ctx!.lineWidth = p.size;
                    ctx!.beginPath();
                    ctx!.moveTo(p.x, p.y);
                    ctx!.lineTo(p.x - p.swayAmp * 0.04, p.y + cfg.streak);
                    ctx!.stroke();
                } else if (cfg.spin) {
                    ctx!.save();
                    ctx!.translate(p.x, p.y);
                    ctx!.rotate(p.rot);
                    ctx!.beginPath();
                    ctx!.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, Math.PI * 2);
                    ctx!.fill();
                    ctx!.restore();
                } else {
                    ctx!.beginPath();
                    ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                    ctx!.fill();
                }
            }

            // Thunderstorm lightning: fire a jagged bolt + a fast-decaying flash on a
            // random cadence — reads as a real strike, not a strobing screen flicker.
            if (lightning) {
                boltCooldown -= dt;
                if (boltCooldown <= 0 && !bolt) {
                    bolt = makeBolt();
                    flash = rand(0.5, 0.85);
                    boltCooldown = rand(2.6, 7) * (lowEnd ? 1.7 : 1);
                }
                if (flash > 0) {
                    ctx!.save();
                    ctx!.globalCompositeOperation = "lighter";
                    ctx!.globalAlpha = 1;
                    ctx!.fillStyle = `rgba(202,224,255,${flash * 0.5})`;
                    ctx!.fillRect(0, 0, w, h);
                    ctx!.restore();
                    flash = Math.max(0, flash - dt * 3.4);
                }
                if (bolt) {
                    bolt.t += dt;
                    const k = 1 - bolt.t / bolt.dur;
                    if (k <= 0) {
                        bolt = null;
                    } else {
                        const fa = k * (0.55 + 0.45 * Math.abs(Math.sin(bolt.t * 55)));
                        ctx!.save();
                        ctx!.globalCompositeOperation = "lighter";
                        ctx!.globalAlpha = 1;
                        ctx!.lineJoin = "round";
                        ctx!.lineCap = "round";
                        strokeBolt(bolt.pts, 2.2, 16, fa);
                        for (const br of bolt.branches) strokeBolt(br, 1.3, 10, fa * 0.8);
                        ctx!.restore();
                    }
                }
            }
            ctx!.globalAlpha = 1;
            ctx!.shadowBlur = 0;
            raf = requestAnimationFrame(draw);
        }

        const ro = new ResizeObserver(resize);
        if (parent) ro.observe(parent);
        resize();

        if (reduce) {
            // Single static frame — no motion, but the scene still gets texture.
            last = 0; running = false;
            ctx.clearRect(0, 0, w, h);
            for (const p of particles) {
                ctx.globalAlpha = p.alpha;
                ctx.fillStyle = p.color;
                ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
            }
            // Reduced motion: one still bolt (no flashing) so the storm still reads.
            if (lightning) {
                ctx.save();
                ctx.globalCompositeOperation = "lighter";
                ctx.globalAlpha = 1;
                ctx.lineJoin = "round";
                ctx.lineCap = "round";
                strokeBolt(makeBolt().pts, 1.6, 0, 0.22);
                ctx.restore();
            }
            ctx.globalAlpha = 1;
        } else {
            raf = requestAnimationFrame(draw);
        }

        function onVis() {
            if (reduce) return;
            if (document.hidden) { running = false; cancelAnimationFrame(raf); }
            else if (!running) { running = true; last = 0; raf = requestAnimationFrame(draw); }
        }
        document.addEventListener("visibilitychange", onVis);

        return () => {
            running = false;
            cancelAnimationFrame(raf);
            ro.disconnect();
            document.removeEventListener("visibilitychange", onVis);
        };
    }, [kinds, intensity, lightning]);

    return (
        <div className={"scene-ambience" + (className ? " " + className : "")} aria-hidden="true">
            <canvas ref={canvasRef} className="scene-ambience-canvas" />
            <div className={"scene-ambience-rays scene-rays-" + biome} />
        </div>
    );
}
