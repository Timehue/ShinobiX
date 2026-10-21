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

test('authored collapse contact catches a narrow paw omitted by the ordinary torso sample', () => {
    const positions = new Float32Array(2048 * 3);
    for (let i = 0; i < 2048; i++) positions[i * 3 + 1] = .1;
    // This vertex lies between the ordinary four-vertex stride samples.
    positions[3 + 1] = -.47;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const parent = new THREE.Group(), surface = new THREE.Group();
    parent.position.y = 2; parent.scale.setScalar(2); parent.add(surface);
    surface.add(new THREE.Mesh(geometry));
    assert.ok(Math.abs(petModelGroundY(surface)! - 2.2) < 1e-6);
    assert.ok(Math.abs(petModelGroundY(surface, true)! - 1.06) < 1e-6);
    geometry.dispose();
});
