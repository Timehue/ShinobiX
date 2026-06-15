/*
 * SectorForeground — a near-camera band of biome foliage/props that frames the
 * sector scene and parallaxes against the painted backdrop as the player crosses
 * the grid. This is the cue that turns "a still picture behind a grid" into
 * "I'm patrolling THROUGH this place": the foreground (closest layer) slides
 * further and faster than the over-scaled backdrop, so moving reveals depth.
 *
 * The art is a single transparent webp per ambience-biome served statically from
 * public/sector-foreground/<biome>.webp (baked by scripts/gen-sector-foreground
 * .mjs, manifest-gated like the depth maps) — never bundled, never in polled
 * state, so cPanel/Cloudflare absorb it for $0 of metered egress. If a biome has
 * no baked band yet, this renders nothing.
 *
 * Sits at z-index 4 (in front of the walking avatar, behind the z-5 encounter
 * markers), pointer-events:none, and only frames the bottom + corners so it never
 * hides the avatar in the play area. Honors prefers-reduced-motion (no idle sway,
 * no parallax travel — a static frame).
 */
import type { CSSProperties } from "react";
import type { Biome } from "../types/core";
import { SECTOR_FOREGROUND_BIOMES } from "../data/sector-foreground-manifest";

const GRID_W = 12;
const PAN = 18; // foreground camera travel (% of its own width) edge-to-edge — bigger than SectorScene's PAN so the near layer parallaxes ahead of the backdrop

function prefersReducedMotion(): boolean {
    return typeof window !== "undefined"
        && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function SectorForeground({ biome, focus }: { biome: Biome; focus: number }) {
    if (!SECTOR_FOREGROUND_BIOMES.has(biome)) return null;

    const still = prefersReducedMotion();
    const col = focus % GRID_W;
    // Closest layer moves the most: shift toward the side the player is on, same
    // sign as the backdrop pan but a larger magnitude (parallax depth).
    const panX = still ? 0 : (0.5 - col / (GRID_W - 1)) * PAN;

    const artStyle: CSSProperties = {
        transform: `translateX(calc(-50% + ${panX}%))`,
    };

    return (
        <div className={"sector-foreground" + (still ? " is-still" : "")} aria-hidden="true">
            <img
                className="sector-foreground-art"
                src={`/sector-foreground/${biome}.webp`}
                alt=""
                draggable={false}
                style={artStyle}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
        </div>
    );
}
