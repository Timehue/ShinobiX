import * as THREE from "three";

/** True only while Three has a decoded payload it can safely upload. */
export function petAtlasHasImageData(atlas: THREE.Texture): boolean {
    return atlas.source?.data != null || atlas.image != null;
}

/**
 * Bind the cache-owned GLTF atlas to a fighter-owned material.
 *
 * GLTFLoader owns both the decoded image and the GPU texture for the lifetime
 * of its URL cache. Texture.clone() only copied the sampler wrapper, and on a
 * preload/remount path its forced upload could run after the transient image
 * payload was gone. Three then rendered the intact mesh with a white map and
 * warned "Texture marked for update but no image data found". Materials may be
 * cloned per fighter; the authored atlas must stay cache-owned and undisposed.
 */
export function bindPetAtlasTexture(source: THREE.Texture, anisotropy: number): THREE.Texture {
    if (!petAtlasHasImageData(source)) return source;

    const changed = source.colorSpace !== THREE.SRGBColorSpace
        || source.anisotropy < anisotropy;
    source.colorSpace = THREE.SRGBColorSpace;
    source.anisotropy = Math.max(anisotropy, source.anisotropy);
    if (changed) source.needsUpdate = true;
    return source;
}

/** Rebind the approved atlas if any runtime material/status path replaces it. */
export function lockPetAtlas(material: THREE.MeshStandardMaterial, atlas: THREE.Texture): void {
    bindPetAtlasTexture(atlas, atlas.anisotropy);
    if (material.map !== atlas) {
        material.map = atlas;
        material.needsUpdate = true;
    }
}
