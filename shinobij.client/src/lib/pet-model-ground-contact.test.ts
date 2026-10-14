import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { petModelGroundY } from './pet-model-ground-contact';

test('collapse ground contact follows visible torso rotation and parent scale', () => {
    const parent = new THREE.Group(), surface = new THREE.Group(); parent.add(surface);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1)); surface.add(mesh);
    mesh.position.y = .3; mesh.rotation.z = Math.PI / 2; parent.position.y = 2; parent.scale.setScalar(2);
    assert.ok(Math.abs(petModelGroundY(surface)! - 1.6) < 1e-6);
    parent.position.y += .4;
    assert.ok(Math.abs(petModelGroundY(surface)! - 2) < 1e-6);
});
test('empty fallback surfaces do not invent a floor offset', () => {
    assert.equal(petModelGroundY(new THREE.Group()), null);
});
