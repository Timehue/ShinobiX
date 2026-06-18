/*
 * SceneAmbience3D — opt-out, lazy gate around the react-three-fiber depth field
 * (SceneAmbience3DScene). Keeping the gate in a tiny non-three module means the
 * three.js bundle is only fetched when the 3D layer actually renders.
 *
 * Disabled automatically under prefers-reduced-motion, and can be turned off
 * per-device via localStorage `sceneAmbience3D.v1 = "off"`. Pairs with the 2D
 * <SceneAmbience> (which sits in front); this layer adds parallax depth behind.
 */
import { Suspense, lazy } from "react";
import type { Biome } from "../types/core";

const Scene = lazy(() => import("./SceneAmbience3DScene"));

function isSceneAmbience3DEnabled(): boolean {
    if (typeof window === "undefined") return false;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
    try {
        if (window.localStorage?.getItem("sceneAmbience3D.v1") === "off") return false;
    } catch { /* private mode — treat as enabled */ }
    return true;
}

export function SceneAmbience3D({ biome, enabled }: { biome: Biome; enabled?: boolean }) {
    if (enabled === false || !isSceneAmbience3DEnabled()) return null;
    return (
        <div className="scene-ambience-3d" aria-hidden="true">
            <Suspense fallback={null}>
                <Scene biome={biome} />
            </Suspense>
        </div>
    );
}
