import * as THREE from 'three';
import { sunscarRandom } from '../../../../shared/sunscar/random';
export function createSandTexture() {
    const side = 128, data = new Uint8Array(side * side * 4), random = sunscarRandom(391);
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
        const ripple = Math.sin(y * Math.PI / 8 + Math.sin(x * Math.PI / 32) * 1.2) * 5;
        const value = 226 + ripple + random() * 22;
        const i = (y * side + x) * 4;
        data[i] = value; data[i + 1] = value; data[i + 2] = value; data[i + 3] = 255;
    }
    const texture = new THREE.DataTexture(data, side, side, THREE.RGBAFormat);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true; texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
    return texture;
}

/** Small shared plank atlas: grain, recessed joints and iron nail heads make
 * cargo readable at race speed without adding another asset request. */
export function createCargoTexture() {
    const side = 128, data = new Uint8Array(side * side * 4), random = sunscarRandom(871);
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
        const joint = y % 32 < 2;
        const nail = (x === 7 || x === 119) && y % 32 >= 5 && y % 32 <= 7;
        const grain = Math.sin(x * .17 + Math.sin(y * .31) * 2) * 8 + Math.sin(x * .7 + y * .15) * 3;
        const value = joint ? 72 : nail ? 44 : 208 + grain + random() * 16;
        const i = (y * side + x) * 4;
        data[i] = value; data[i + 1] = value * .94; data[i + 2] = value * .84; data[i + 3] = 255;
    }
    const texture = new THREE.DataTexture(data, side, side, THREE.RGBAFormat);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true; texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
    return texture;
}
