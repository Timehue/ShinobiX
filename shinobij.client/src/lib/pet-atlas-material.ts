import * as THREE from "three";

/**
 * Keep the decoded image payload from GLTFLoader, but create a fighter-owned
 * WebGL texture. This prevents a preload/remount or stale cache entry from
 * invalidating the sampler used by a live Coliseum model.
 */
export function isolatePetAtlasTexture(source: THREE.Texture, anisotropy: number, name: string): THREE.Texture {
    const atlas = source.clone();
    atlas.name = `${source.name || name}-combat-atlas`;
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.anisotropy = Math.max(anisotropy, source.anisotropy);
    atlas.needsUpdate = true;
    return atlas;
}

/** Rebind the approved atlas if any runtime material/status path replaces it. */
export function lockPetAtlas(material: THREE.MeshStandardMaterial, atlas: THREE.Texture): void {
    if (material.map !== atlas) {
        material.map = atlas;
        material.needsUpdate = true;
    }
    atlas.colorSpace = THREE.SRGBColorSpace;
}
