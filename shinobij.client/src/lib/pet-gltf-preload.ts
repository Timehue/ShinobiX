import { useGLTF } from "@react-three/drei";
import { suspend } from "suspend-react";
import { GLTFLoader } from "three-stdlib";

function missingPreloadEntry(): Promise<never> {
    // Only observe the entry created by Drei. If its key contract changes,
    // reject rather than starting a second loader or reporting false readiness.
    throw new Error("Pet GLTF preload cache entry is unavailable");
}

/** Await the same parsed GLTF consumed by useGLTF(url). Drei's preload returns
 * void; Fiber's shared Suspense entry uses [three-stdlib GLTFLoader, url].
 * This observer owns no model, loader, cache, or GPU resource. Parsing complete
 * does not imply that a Canvas has mounted or shaders/textures are GPU-ready. */
export async function preloadPetGltf(url: string): Promise<void> {
    useGLTF.preload(url);
    for (;;) {
        try {
            suspend(missingPreloadEntry, [GLTFLoader, url]);
            return;
        } catch (pending: unknown) {
            if (pending === null || typeof pending !== "object" || !("then" in pending)
                || typeof pending.then !== "function") throw pending;
            await (pending as PromiseLike<unknown>);
            // suspend-react stores load errors and resolves its pending promise.
            // Read again so an error cannot be mistaken for a parsed model.
        }
    }
}
