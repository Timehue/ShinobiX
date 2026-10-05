import type { MeshBasicMaterial, Texture } from 'three';

/** Flipbook frames use ordinary 2D textures. Changing the image does not
 * change the shader; adding/removing its map or changing UV channels does. */
export function setPetEffectTexture(material: MeshBasicMaterial, texture: Texture | null) {
    const previous = material.map;
    if (previous === texture) return;
    material.map = texture;
    if (!!previous !== !!texture || previous?.channel !== texture?.channel) material.needsUpdate = true;
}
