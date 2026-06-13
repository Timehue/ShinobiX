/*
 * SectorScene3D — opt-out, lazy gate around the react-three-fiber sector depth
 * scene (SectorScene3DScene). Keeping the gate in a tiny non-three module means
 * the three.js bundle is only fetched when the 3D backdrop actually renders.
 *
 * Disabled automatically under prefers-reduced-motion, and can be turned off
 * per-device via localStorage `sectorScene3D.v1 = "off"`. Sits behind the tile
 * grid (z-index:-1) on top of the flat <SectorScene> CSS backdrop, which stays
 * as the fallback when 3D is off. pointer-events:none — click-to-move and the
 * <SectorAvatar> overlay are untouched.
 */
import { Suspense, lazy } from "react";
import type { Biome } from "../types/core";

const Scene = lazy(() => import("./SectorScene3DScene"));

export function isSectorScene3DEnabled(): boolean {
    if (typeof window === "undefined") return false;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
    try {
        if (window.localStorage?.getItem("sectorScene3D.v1") === "off") return false;
    } catch { /* private mode — treat as enabled */ }
    return true;
}

export function SectorScene3D({ image, biome, focus, depth, enabled }: { image?: string; biome: Biome; focus: number; depth?: string; enabled?: boolean }) {
    if (enabled === false || !image || !isSectorScene3DEnabled()) return null;
    return (
        <div className="sector-scene-3d" aria-hidden="true">
            <Suspense fallback={null}>
                <Scene image={image} biome={biome} focus={focus} depth={depth} />
            </Suspense>
        </div>
    );
}
