/*
 * SectorScene — the biome backdrop for a sector, with a subtle position-driven
 * "camera" pan (Ken Burns) + atmospheric haze + a framing vignette. Track 2
 * (CSS-first) of the living-sectors work: makes the painted biome read as a
 * place you're moving THROUGH rather than a flat picture behind a grid.
 *
 * The backdrop is a slightly over-scaled image on its OWN layer, so it can be
 * transformed (panned) without moving the tile grid or the <SectorAvatar>
 * overlay — click-to-move math and avatar alignment stay exact. As the player
 * crosses the grid the camera glides toward the side they're on. Pure
 * CSS/transform, no new assets, $0. The backdrop + haze sit behind the tiles
 * (z-index:-1); the vignette frames the distant scene (z-index:2) without
 * touching the foreground avatar/particles/markers. All pointer-events:none.
 *
 * Honors prefers-reduced-motion (static, centred — no pan, no drift). Replaces
 * the inline background-image that used to live on the .sector-image-map grid.
 */
import type { CSSProperties } from "react";
import type { Biome } from "../types/core";

const GRID_W = 12;
// Over-scale gives pan headroom while always covering the grid. Kept equal to the
// r3f scene's OVERSHOOT (SectorScene3DScene) so the flat backdrop and the 3D
// parallax layer frame the painting at the SAME zoom — otherwise the 3D layer
// fading in over this one reads as the scene zooming/reloading.
const SCALE = 1.5;
const PAN = 12;    // max camera travel (% of the backdrop) from edge to edge

function prefersReducedMotion(): boolean {
    return typeof window !== "undefined"
        && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function SectorScene({ image, biome, focus }: { image?: string; biome: Biome; focus: number }) {
    const col = focus % GRID_W;
    const row = Math.floor(focus / GRID_W);
    const still = prefersReducedMotion();
    // Camera centres on the side the player is on: on the left column we shift
    // the backdrop right to reveal its left side, and vice-versa.
    const panX = still ? 0 : (0.5 - col / (GRID_W - 1)) * PAN;
    const panY = still ? 0 : (0.5 - row / (GRID_W - 1)) * PAN;

    const backdropStyle: CSSProperties = {
        backgroundImage: image ? `url(${image})` : undefined,
        transform: `scale(${SCALE}) translate(${panX}%, ${panY}%)`,
    };

    return (
        <>
            <div className="sector-scene-backdrop" style={backdropStyle} aria-hidden="true" />
            <div className={`sector-scene-haze sector-scene-haze-${biome}`} aria-hidden="true" />
            <div className="sector-scene-vignette" aria-hidden="true" />
        </>
    );
}
