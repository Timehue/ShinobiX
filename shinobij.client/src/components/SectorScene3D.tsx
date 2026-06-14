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
import { Suspense, lazy, useState } from "react";
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

// Inner layer (always mounted when the gate decides to render) so it can own the
// fade-in hooks. The flat <SectorScene> backdrop sits underneath at the same
// z-index as the load-time fallback; this 3D layer starts transparent and only
// fades in once its first frame has painted (`onReady`), so the two framings of
// the same painting never swap or stack visibly. On a sector change we drop back
// to 0 and let the flat backdrop show until the new scene paints, so a switch
// never flashes the previous sector's 3D image.
function SectorScene3DLayer({ image, biome, focus, depth }: { image: string; biome: Biome; focus: number; depth?: string }) {
    const [ready, setReady] = useState(false);
    // Reset the fade when the painting changes (new sector) using the canonical
    // "adjust state during render" pattern — not an effect — so the flat backdrop
    // shows until the new scene paints instead of flashing the previous one.
    const [renderedImage, setRenderedImage] = useState(image);
    if (image !== renderedImage) {
        setRenderedImage(image);
        setReady(false);
    }
    return (
        <div
            className="sector-scene-3d"
            aria-hidden="true"
            style={{ opacity: ready ? 1 : 0, transition: "opacity 500ms ease-out" }}
        >
            <Suspense fallback={null}>
                <Scene image={image} biome={biome} focus={focus} depth={depth} onReady={() => setReady(true)} />
            </Suspense>
        </div>
    );
}

export function SectorScene3D({ image, biome, focus, depth, enabled }: { image?: string; biome: Biome; focus: number; depth?: string; enabled?: boolean }) {
    if (enabled === false || !image || !isSectorScene3DEnabled()) return null;
    return <SectorScene3DLayer image={image} biome={biome} focus={focus} depth={depth} />;
}
