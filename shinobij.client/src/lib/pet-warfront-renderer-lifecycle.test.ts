import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createWarfrontRendererResources } from "./pet-warfront-renderer-lifecycle";

test("renderer retirement releases shared texture bindings and the built-in DFG LUT exactly once", () => {
    const sourceImage = { width: 512, height: 512 };
    const atlas = new THREE.Texture(sourceImage);
    const dfgLut = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas });
    const scene = new THREE.Scene();
    const geometry = new THREE.PlaneGeometry();
    const sourcePositions = geometry.attributes.position.array;
    scene.add(new THREE.Mesh(geometry, material));
    const releases: string[] = [];
    atlas.addEventListener("dispose", () => releases.push("atlas"));
    dfgLut.addEventListener("dispose", () => releases.push("dfg-lut"));
    geometry.addEventListener("dispose", () => releases.push("geometry"));
    const renderer = {
        properties: { get: () => ({ uniforms: { dfgLUT: { value: dfgLut }, map: { value: atlas } } }) },
        dispose: () => releases.push("renderer"),
    } as unknown as THREE.WebGLRenderer;
    const resources = createWarfrontRendererResources(renderer);
    resources.capture(scene);
    resources.capture(scene);
    scene.clear(); // R3F removes children before passive unmount cleanup.
    resources.dispose();
    resources.dispose();
    assert.deepEqual(releases, ["atlas", "dfg-lut", "geometry", "renderer"]);
    assert.equal(atlas.image, sourceImage, "shared decoded model sources remain available for the next battle");
    assert.equal(geometry.attributes.position.array, sourcePositions, "shared CPU geometry remains available for the next battle");
});

test("resources retired by a clash leave the renderer tracker before canvas retirement", () => {
    const geometry = new THREE.ShapeGeometry(new THREE.Shape().moveTo(0, 0).lineTo(1, 0).lineTo(0, 1));
    const texture = new THREE.Texture();
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture })));
    const releases: string[] = [];
    geometry.addEventListener("dispose", () => releases.push("geometry"));
    texture.addEventListener("dispose", () => releases.push("texture"));
    const renderer = {
        properties: { get: () => ({ uniforms: {} }) },
        dispose: () => releases.push("renderer"),
    } as unknown as THREE.WebGLRenderer;
    const resources = createWarfrontRendererResources(renderer);
    resources.capture(scene);
    scene.clear();
    geometry.dispose();
    texture.dispose();
    resources.dispose();
    assert.deepEqual(releases, ["geometry", "texture", "renderer"]);
});
