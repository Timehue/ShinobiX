/*
 * SectorMap — the new sector look: a single hand-painted top-down ADVENTURE MAP
 * (Pokémon-route / tactical-overworld style) drawn full-bleed behind the 12×12
 * movement grid. The whole sector is one cohesive painted board — paths, terrain
 * features and small points of interest, no empty centre — and the orb + gameplay
 * markers render on top (the existing grid overlay is untouched).
 *
 * Unlike SectorScene (the old biome VISTA, which over-scales + Ken Burns pans), the
 * map is a BOARD: it fills the grid exactly with no pan and no over-scale, so the
 * painted layout stays aligned under the tiles. A soft edge vignette frames the
 * board and lifts the centre so the orb stays readable on the trails. The painted
 * art is smooth (image-rendering:auto), overriding the grid's pixelated default.
 *
 * Default ON for everyone; opt-out with localStorage `sectorMap.v1 = "off"` (falls
 * back to the old SectorScene vista). All layers pointer-events:none + behind the
 * tiles, so click-to-move and the avatar/markers overlays are untouched.
 */
import type { CSSProperties } from "react";

export function isSectorMapEnabled(): boolean {
    if (typeof window === "undefined") return false;
    try { return window.localStorage?.getItem("sectorMap.v1") !== "off"; } catch { return true; }
}

export function SectorMap({ image }: { image?: string }) {
    const style: CSSProperties = { backgroundImage: image ? `url(${image})` : undefined };
    return (
        <>
            <div className="sector-map-backdrop" style={style} aria-hidden="true" />
            <div className="sector-map-vignette" aria-hidden="true" />
        </>
    );
}
