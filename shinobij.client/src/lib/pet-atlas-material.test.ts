import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { bindPetAtlasTexture, lockPetAtlas, petAtlasHasImageData } from "./pet-atlas-material";

test("Coliseum fighters reuse the cache-owned GLTF atlas", () => {
    const cached = new THREE.Texture({ width: 16, height: 16 });
    cached.name = "mythic-4-atlas";
    cached.anisotropy = 2;
    cached.colorSpace = THREE.LinearSRGBColorSpace;

    const bound = bindPetAtlasTexture(cached, 8);
    assert.equal(bound, cached, "the loader cache must remain the texture owner");
    assert.equal(bound.colorSpace, THREE.SRGBColorSpace);
    assert.equal(bound.anisotropy, 8);
    assert.ok(bound.version > 0, "a decoded atlas can safely refresh changed sampling metadata");
});

test("an image-less cache entry is never forced through a broken upload", () => {
    const cached = new THREE.Texture();
    cached.colorSpace = THREE.LinearSRGBColorSpace;
    assert.equal(petAtlasHasImageData(cached), false);

    const bound = bindPetAtlasTexture(cached, 8);
    assert.equal(bound, cached);
    assert.equal(bound.version, 0, "no upload should be requested without image data");
    assert.equal(bound.colorSpace, THREE.LinearSRGBColorSpace);
});

test("an approved roster material restores its authored atlas after mutation", () => {
    const authored = new THREE.Texture({ width: 16, height: 16 });
    authored.colorSpace = THREE.LinearSRGBColorSpace;
    const material = new THREE.MeshStandardMaterial({ color: "white" });
    material.map = new THREE.Texture();

    lockPetAtlas(material, authored);
    assert.equal(material.map, authored);
    assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);
    assert.ok(material.version > 0, "rebinding must invalidate the material program");
});
