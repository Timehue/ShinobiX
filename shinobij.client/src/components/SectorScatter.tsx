/*
 * SectorScatter — fills a sector's play-field with biome ground-objects (rocks,
 * bushes, crystals, mushrooms, lanterns, cacti) so it reads as a dense, explorable
 * landscape instead of an empty grid over a painting. This is the "lots of stuff
 * on the ground" density that tile-based competitors get from per-hex sprites —
 * but here it layers UNDER the moving avatar, day/night wash, wildlife and weather
 * the flat tile maps lack.
 *
 * Placement is DETERMINISTIC per sector (seeded by the sector number), so every
 * sector has its own stable layout that never reshuffles on re-render or reload —
 * the same property tile maps have. Props are depth-scaled (lower on screen =
 * bigger + drawn in front), grounded with a soft contact shadow, and sway gently;
 * "glow" props (lanterns, crystals, vents) pulse. LOW objects only — no tall trees
 * — so they sit on the walkable plane and complement the painted vista's
 * perspective rather than fighting it.
 *
 * Manifest-gated (sector-props-manifest.ts) + served statically from
 * public/sector-props/<biome>/<id>.webp: $0 metered egress, no-op when a biome
 * has no baked props. Sits at z-index -1 (below the tile grid, so it never hides
 * other-player markers or the gold target tile) and is fully pointer-events:none.
 */
import { useMemo, type CSSProperties } from "react";
import type { Biome } from "../types/core";
import { SECTOR_PROP_IDS } from "../data/sector-props-manifest";

const GRID = 12;
const COUNT = 26;      // props per sector — dense enough to fill, sparse enough to read
const TOP_ROW = 2;     // keep the top rows clearer (distant sky/canopy of the painting)

// Halo colour for the glow props, so an ice crystal glows cold-blue and a lava
// vent glows hot-orange instead of a generic gold.
const GLOW_COLOR: Record<string, string> = {
    "ice-crystal": "rgba(150,210,255,0.6)",
    "ember-vent": "rgba(255,140,60,0.65)",
    "spirit-lantern": "rgba(190,130,255,0.6)",
    "mushroom": "rgba(120,230,200,0.55)",
    "stone-lantern": "rgba(255,210,130,0.65)",
};

// Visual metadata per prop id (defaults applied when absent). `base` scales the
// prop's footprint; `glow` adds a pulsing light halo.
const PROP_META: Record<string, { glow?: boolean; base?: number }> = {
    "snow-rock": { base: 0.95 }, "snow-shrub": { base: 1.0 }, "ice-crystal": { glow: true, base: 0.8 }, "snow-mound": { base: 1.15 },
    "lava-rock": { base: 1.0 }, "obsidian-shard": { base: 0.85 }, "ember-vent": { glow: true, base: 0.85 }, "charred-shrub": { base: 0.95 },
    "spirit-lantern": { glow: true, base: 1.05 }, "petal-bush": { base: 1.05 }, "dark-grass": { base: 0.9 }, "mossy-stone": { base: 1.0 },
    "mushroom": { glow: true, base: 0.8 }, "mossy-rock": { base: 0.95 }, "fern-bush": { base: 1.05 }, "wildflowers": { base: 0.8 },
    "stone-lantern": { glow: true, base: 1.1 }, "garden-bush": { base: 1.05 }, "ornamental-rock": { base: 0.9 }, "grass-tuft": { base: 0.8 },
};

// mulberry32 — tiny deterministic PRNG so a sector's scatter is stable across
// renders/reloads (seeded by the sector number).
function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

interface Placed {
    key: number; id: string; left: number; top: number; z: number;
    scale: number; flip: number; glow: boolean; dur: number; delay: number;
}

export function SectorScatter({ sector, biome }: { sector: number; biome: Biome }) {
    const ids = SECTOR_PROP_IDS[biome];

    const placed = useMemo<Placed[]>(() => {
        if (!ids || ids.length === 0) return [];
        const rnd = mulberry32(((sector | 0) * 2654435761) >>> 0 || 1);
        const out: Placed[] = [];
        for (let i = 0; i < COUNT; i++) {
            const id = ids[(rnd() * ids.length) | 0];
            const col = (rnd() * GRID) | 0;
            const row = TOP_ROW + ((rnd() * (GRID - TOP_ROW)) | 0);
            const jx = (rnd() - 0.5) * 0.7;
            const jy = (rnd() - 0.5) * 0.5;
            const left = ((col + 0.5 + jx) / GRID) * 100;
            const top = ((row + 0.5 + jy) / GRID) * 100;
            const depth = row / (GRID - 1);                 // 0 (far/top) → 1 (near/bottom)
            const base = PROP_META[id]?.base ?? 1;
            const scale = (0.55 + depth * 0.75) * base;
            out.push({
                key: i, id, left, top,
                z: Math.round(top * 10),                     // lower on screen → painted in front
                scale,
                flip: rnd() < 0.5 ? -1 : 1,
                glow: !!PROP_META[id]?.glow,
                dur: 5 + rnd() * 5,
                delay: -rnd() * 8,
            });
        }
        // paint top-to-bottom so nearer props overlap farther ones
        out.sort((a, b) => a.top - b.top);
        return out;
    }, [sector, ids]);

    if (placed.length === 0) return null;

    return (
        <div className="sector-scatter" aria-hidden="true">
            {placed.map((p) => (
                <div
                    key={p.key}
                    className={"sector-scatter-prop" + (p.glow ? " is-glow" : "")}
                    style={{ left: `${p.left}%`, top: `${p.top}%`, zIndex: p.z, ["--s"]: p.scale, ["--glow-c"]: GLOW_COLOR[p.id] ?? "rgba(255,225,150,0.55)" } as CSSProperties}
                >
                    <span className="sector-scatter-shadow" />
                    {p.glow && <span className="sector-scatter-glow" style={{ animationDelay: `${p.delay}s` } as CSSProperties} />}
                    <span className="sector-scatter-sway" style={{ animationDuration: `${p.dur}s`, animationDelay: `${p.delay}s` } as CSSProperties}>
                        <img
                            className="sector-scatter-img"
                            src={`/sector-props/${biome}/${p.id}.webp`}
                            alt=""
                            draggable={false}
                            style={{ transform: `scaleX(${p.flip})` }}
                            onError={(e) => { const host = (e.currentTarget.closest(".sector-scatter-prop") as HTMLElement | null); if (host) host.style.display = "none"; }}
                        />
                    </span>
                </div>
            ))}
        </div>
    );
}
