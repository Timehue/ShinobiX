import type { BufferGeometry, Material, Object3D, Texture, WebGLRenderer } from "three";

/** R3F loses its context at unmount but does not dispose the renderer. Cached
 * geometry and textures (including Three's DFG lookup) retain per-renderer GPU
 * bindings/closures, which retain the context, canvas and detached battle DOM.
 * Keep CPU source arrays/images cached; release GPU bindings first. */
export function createWarfrontRendererResources(renderer: WebGLRenderer) {
    const textures = new Set<Texture>();
    const geometries = new Set<BufferGeometry>();
    let disposed = false;
    const track = (value: unknown) => {
        if (value && typeof value === "object" && (value as Texture).isTexture) textures.add(value as Texture);
        else if (Array.isArray(value)) for (const item of value) {
            if (item && typeof item === "object" && (item as Texture).isTexture) textures.add(item as Texture);
        }
    };
    const trackUniforms = (uniforms: Record<string, { value?: unknown }> | undefined) => {
        if (uniforms) for (const uniform of Object.values(uniforms)) track(uniform?.value);
    };
    return {
        capture(scene: Object3D) {
            if (disposed) return;
            track((scene as Object3D & { background?: unknown }).background);
            track((scene as Object3D & { environment?: unknown }).environment);
            scene.traverse((object) => {
                const geometry = (object as Object3D & { geometry?: BufferGeometry }).geometry;
                if (geometry?.isBufferGeometry) geometries.add(geometry);
                const material = (object as Object3D & { material?: Material | Material[] }).material;
                if (!material) return;
                for (const item of Array.isArray(material) ? material : [material]) {
                    for (const value of Object.values(item)) track(value);
                    trackUniforms((item as Material & { uniforms?: Record<string, { value?: unknown }> }).uniforms);
                    // Built-in uniforms own renderer-created shared textures,
                    // notably the DFG_LUT absent from material.map/envMap.
                    const properties = renderer.properties.get(item) as { uniforms?: Record<string, { value?: unknown }> };
                    trackUniforms(properties.uniforms);
                }
            });
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            for (const texture of textures) texture.dispose();
            for (const geometry of geometries) geometry.dispose();
            textures.clear();
            geometries.clear();
            renderer.dispose();
        },
    };
}
