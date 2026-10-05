import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeshBasicMaterial, Texture } from 'three';
import { setPetEffectTexture } from './pet-effect-texture';

test('flipbook image swaps reuse shaders, while map and UV changes invalidate them', () => {
    const material = new MeshBasicMaterial();
    const first = new Texture(), second = new Texture(), alternateUv = new Texture();
    alternateUv.channel = 1;
    setPetEffectTexture(material, first);
    const mappedVersion = material.version;
    assert.equal(mappedVersion, 1);
    for (let i = 0; i < 120; i++) setPetEffectTexture(material, i % 2 ? first : second);
    assert.equal(material.version, mappedVersion);
    assert.equal(material.map, first);
    setPetEffectTexture(material, alternateUv);
    assert.equal(material.version, mappedVersion + 1);
    setPetEffectTexture(material, null);
    assert.equal(material.version, mappedVersion + 2);
    setPetEffectTexture(material, null);
    assert.equal(material.version, mappedVersion + 2);
    material.dispose(); first.dispose(); second.dispose(); alternateUv.dispose();
});
