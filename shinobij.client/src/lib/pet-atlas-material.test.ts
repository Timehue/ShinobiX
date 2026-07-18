import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { isolatePetAtlasTexture, lockPetAtlas } from "./pet-atlas-material";

test("Coliseum fighters own an sRGB atlas sampler instead of the GLTF cache texture", () => {
    const cached = new THREE.Texture({ width: 16, height: 16 });
    cached.name = "mythic-4-atlas";
    cached.anisotropy = 2;
    cached.colorSpace = THREE.LinearSRGBColorSpace;

    const isolated = isolatePetAtlasTexture(cached, 8, "mythic-4");
    assert.notEqual(isolated, cached);
    assert.equal(isolated.source, cached.source, "the decoded image payload should be reused");
    assert.equal(isolated.colorSpace, THREE.SRGBColorSpace);
    assert.equal(isolated.anisotropy, 8);
    assert.match(isolated.name, /combat-atlas$/);
    assert.ok(isolated.version > 0, "the isolated sampler must upload on first render");
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
