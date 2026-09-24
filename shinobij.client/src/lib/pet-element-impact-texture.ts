import * as THREE from "three";
import {
    PET_ELEMENT_IMPACT_ATLAS_COLUMNS,
    PET_ELEMENT_IMPACT_ATLAS_ROWS,
    PET_ELEMENT_IMPACT_CELL_SIZE,
    petElementImpactUvCell,
} from "./pet-element-vfx";

const CELL_U = 1 / PET_ELEMENT_IMPACT_ATLAS_COLUMNS;
const CELL_V = 1 / PET_ELEMENT_IMPACT_ATLAS_ROWS;
const INSET_U = 2 / (PET_ELEMENT_IMPACT_ATLAS_COLUMNS * PET_ELEMENT_IMPACT_CELL_SIZE);
const INSET_V = 2 / (PET_ELEMENT_IMPACT_ATLAS_ROWS * PET_ELEMENT_IMPACT_CELL_SIZE);
const impactGeometryCache = new Map<string, THREE.PlaneGeometry>();

/** Keep atlas cells isolated during bilinear sampling and mipmap generation. */
export function preparePetElementImpactTexture(texture: THREE.Texture): THREE.Texture {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
}

/** A camera-facing plane whose UVs address one isolated atlas cell. Geometry is
 *  shared per element, matching the renderer's cached wind, fire, and water
 *  volumes. A null result means neutral combat should keep its sharp primitive. */
export function cachedPetElementImpactGeometry(value: string | null | undefined): THREE.PlaneGeometry | null {
    const cell = petElementImpactUvCell(value);
    if (!cell) return null;
    const key = `${cell.column}:${cell.row}`;
    const cached = impactGeometryCache.get(key);
    if (cached) return cached;

    const geometry = new THREE.PlaneGeometry(1, 1);
    const uv = geometry.attributes.uv;
    const u0 = cell.column * CELL_U + INSET_U;
    const v0 = (1 - cell.row) * CELL_V + INSET_V;
    const uSpan = CELL_U - INSET_U * 2;
    const vSpan = CELL_V - INSET_V * 2;
    for (let index = 0; index < uv.count; index++) {
        uv.setXY(index, u0 + uv.getX(index) * uSpan, v0 + uv.getY(index) * vSpan);
    }
    uv.needsUpdate = true;
    geometry.name = `pet-element-impact-${value ?? "none"}`;
    geometry.computeBoundingSphere();
    impactGeometryCache.set(key, geometry);
    return geometry;
}
