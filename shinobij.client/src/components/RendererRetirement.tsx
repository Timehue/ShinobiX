/*
 * <RendererRetirement /> — mount once, as a direct child of every R3F <Canvas>
 * (outside any <Suspense>, so it is present while models are still loading).
 * It draws nothing. It lets a retiring canvas hand back the shared, cached
 * resources it bound, so the dead renderer, its WebGL context and its detached
 * DOM can be garbage-collected. The mechanism and the measurement are in
 * lib/three-renderer-retirement.ts; RendererRetirement.wiring.test.ts fails if
 * a new <Canvas> ships without it.
 */
import { useEffect } from "react";
import { addAfterEffect, useThree } from "@react-three/fiber";
import type { WebGLRenderer } from "three";
import { createRendererRetirement, type RendererRetirement as Retirement } from "../lib/three-renderer-retirement";

// A shared material swapped onto an existing mesh changes no texture, geometry
// or program count. A slow unconditional look catches it (~2s at 60fps).
const RECAPTURE_EVERY_FRAMES = 120;

// One retirement per renderer, held outside React: neither a StrictMode double
// render nor a discarded memo can mint a second one for the same live context.
type Mount = { retirement: Retirement; generation: number };
const mounts = new WeakMap<WebGLRenderer, Mount>();

export function RendererRetirement(): null {
    const gl = useThree((state) => state.gl);
    const scene = useThree((state) => state.scene);

    useEffect(() => {
        let mount = mounts.get(gl);
        if (!mount) {
            mount = { retirement: createRendererRetirement(gl), generation: 0 };
            mounts.set(gl, mount);
        }
        const { retirement } = mount;
        const owner = mount;
        const generation = ++owner.generation;

        let textures = -1, geometries = -1, programs = -1, framesSinceCapture = 0;
        // After the draw, not before it: built-in uniforms (three's DFG lookup)
        // exist only once a frame has rendered, and a demand-mode canvas may
        // never render a second one.
        const stopCapturing = addAfterEffect(() => {
            const memory = gl.info.memory;
            const programCount = gl.info.programs?.length ?? 0;
            framesSinceCapture += 1;
            const changed = memory.textures !== textures || memory.geometries !== geometries || programCount !== programs;
            if (!retirement.consumeStale() && !changed && framesSinceCapture < RECAPTURE_EVERY_FRAMES) return;
            textures = memory.textures;
            geometries = memory.geometries;
            programs = programCount;
            framesSinceCapture = 0;
            retirement.capture(scene);
        });

        return () => {
            stopCapturing();
            // StrictMode re-runs effects against the same live WebGLRenderer.
            // Only its final retirement may release shared GPU bindings.
            window.setTimeout(() => {
                if (owner.generation === generation) retirement.dispose();
            }, 0);
        };
    }, [gl, scene]);

    return null;
}
