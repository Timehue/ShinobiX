import type { Object3D, WebGLRenderer } from "three";

/*
 * Renderer retirement for every R3F <Canvas> (the Warfront stage keeps its own,
 * older copy of this idea in pet-warfront-renderer-lifecycle.ts).
 *
 * THE LEAK. Three binds a resource to a renderer by adding a `dispose` listener
 * to it, and `WebGLRenderer.dispose()` never takes those listeners back. R3F
 * force-loses the context at unmount, which frees the GPU memory, but anything
 * that outlives the canvas keeps the listener — and the listener's closure is
 * the dead renderer: its WebGL context, its detached <canvas>, and the DOM and
 * React fibers hanging off that canvas. Three long-lived owners do this here:
 * three's own module-level DFG lookup texture (any PBR material), the drei
 * GLTF/texture cache (every pet model), and the app's cached VFX geometry.
 * Measured 2026-09-18 with a forced GC: 4 of 4 contexts survived four mounts of
 * the sector backdrop and of a pet model; a canvas with no shared resource
 * freed all but the most recent.
 *
 * THE FIX. While the canvas draws, remember what it has bound. When it retires,
 * `dispose()` those resources — three's listeners run, release their bindings
 * and remove themselves — then dispose the renderer. CPU-side data (decoded
 * images, vertex arrays, the cached GLTF) is untouched, so the next canvas
 * re-binds the same cached objects at no extra download or parse.
 *
 * A resource another LIVE canvas is also drawing is left to that canvas's own
 * retirement: disposing it now would make the survivor re-upload the texture or
 * recompile the shader mid-scene. Its listener set is cleared in one go when
 * the last canvas using it retires.
 */

type DisposeListener = () => void;
type Releasable = {
    dispose(): void;
    addEventListener(type: "dispose", listener: DisposeListener): void;
    removeEventListener(type: "dispose", listener: DisposeListener): void;
};
type Keyed = Record<string, unknown>;
type UniformMap = Record<string, { value?: unknown } | undefined>;

export type RendererRetirement = {
    /** Remember the texture, geometry and material bindings reachable from `scene`. */
    capture(scene: Object3D): void;
    /** True once after a tracked resource was disposed elsewhere (owner or sibling
     *  canvas): a still-mounted user re-binds it on its next draw, so look again. */
    consumeStale(): boolean;
    tracks(resource: object): boolean;
    /** Idempotent. Releases this renderer's bindings, then the renderer itself. */
    dispose(): void;
};

const liveRetirements = new Set<RendererRetirement>();

function isReleasable(value: unknown): value is Releasable {
    if (!value || typeof value !== "object") return false;
    const candidate = value as { isTexture?: boolean; isBufferGeometry?: boolean; isMaterial?: boolean };
    return candidate.isTexture === true || candidate.isBufferGeometry === true || candidate.isMaterial === true;
}

export function createRendererRetirement(renderer: WebGLRenderer): RendererRetirement {
    const tracked = new Map<Releasable, DisposeListener>();
    let retired = false;
    let stale = false;

    const track = (value: unknown) => {
        if (!isReleasable(value) || tracked.has(value)) return;
        const onReleasedElsewhere = () => {
            value.removeEventListener("dispose", onReleasedElsewhere);
            tracked.delete(value);
            stale = true;
        };
        value.addEventListener("dispose", onReleasedElsewhere);
        tracked.set(value, onReleasedElsewhere);
    };
    const trackTextures = (value: unknown) => {
        if (Array.isArray(value)) for (const item of value) { if ((item as { isTexture?: boolean } | null)?.isTexture) track(item); }
        else if ((value as { isTexture?: boolean } | null)?.isTexture) track(value);
    };
    const trackUniforms = (uniforms: UniformMap | undefined) => {
        if (!uniforms) return;
        for (const name in uniforms) trackTextures(uniforms[name]?.value);
    };

    const retirement: RendererRetirement = {
        capture(scene) {
            if (retired) return;
            // Registered on first use, not at creation: a StrictMode render can
            // build a second instance that is thrown away without a dispose().
            liveRetirements.add(retirement);
            trackTextures((scene as Object3D & { background?: unknown }).background);
            trackTextures((scene as Object3D & { environment?: unknown }).environment);
            scene.traverse((object) => {
                const node = object as Object3D & {
                    geometry?: unknown;
                    material?: unknown;
                    skeleton?: { boneTexture?: unknown } | null;
                };
                if ((node.geometry as { isBufferGeometry?: boolean } | undefined)?.isBufferGeometry) track(node.geometry);
                // A cached rig drawn without cloning owns its bone texture here.
                trackTextures(node.skeleton?.boneTexture);
                if (!node.material) return;
                for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
                    if (!(material as { isMaterial?: boolean } | null)?.isMaterial) continue;
                    track(material);
                    const fields = material as Keyed;
                    for (const key in fields) trackTextures(fields[key]);
                    trackUniforms(fields.uniforms as UniformMap | undefined);
                    // Built-in uniforms hold renderer-chosen shared textures, notably
                    // three's DFG_LUT, which no material field ever names. `has` first:
                    // `get` would mint an entry for a material this renderer never drew.
                    if (renderer.properties.has(material)) {
                        trackUniforms((renderer.properties.get(material) as { uniforms?: UniformMap }).uniforms);
                    }
                }
            });
        },
        consumeStale() {
            const wasStale = stale;
            stale = false;
            return wasStale;
        },
        tracks(resource) {
            return tracked.has(resource as Releasable);
        },
        dispose() {
            if (retired) return;
            retired = true;
            liveRetirements.delete(retirement);
            const resources = [...tracked.keys()];
            for (const [resource, listener] of tracked) resource.removeEventListener("dispose", listener);
            tracked.clear();
            for (const resource of resources) {
                let drawnElsewhere = false;
                for (const other of liveRetirements) if (other.tracks(resource)) { drawnElsewhere = true; break; }
                if (!drawnElsewhere) resource.dispose();
            }
            renderer.dispose();
        },
    };
    return retirement;
}
