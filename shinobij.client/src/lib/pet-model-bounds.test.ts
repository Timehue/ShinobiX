import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { petModelPresentationBounds, stablePetModelPresentationBounds } from "./pet-model-bounds";

function pointMesh(points: readonly [number, number, number][]): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points.flat(), 3));
    return new THREE.Mesh(geometry);
}

test("presentation bounds ignore sparse proxy geometry when fitting a creature", () => {
    const root = new THREE.Group();
    const body: [number, number, number][] = [];
    for (let layer = 0; layer < 20; layer += 1) {
        for (let row = 0; row < 10; row += 1) {
            for (let column = 0; column < 10; column += 1) {
                body.push([
                    -1 + column * (2 / 9),
                    layer * (2 / 19),
                    -0.5 + row * (1 / 9),
                ]);
            }
        }
    }
    root.add(pointMesh(body));
    root.add(pointMesh([
        [-40, -40, -40],
        [40, -40, -40],
        [-40, 40, -40],
        [40, 40, -40],
        [-40, -40, 40],
        [40, -40, 40],
        [-40, 40, 40],
        [40, 40, 40],
    ]));

    const bounds = petModelPresentationBounds(root);
    assert.equal(bounds.raw.min.x, -40);
    assert.equal(bounds.raw.max.y, 40);
    assert.ok(bounds.fit.getSize(new THREE.Vector3()).x < 2.1);
    assert.ok(bounds.fit.getSize(new THREE.Vector3()).y < 2.1);
    assert.ok(bounds.groundY > -1);
});

test("presentation grounding keeps a meaningful low contact patch", () => {
    const root = new THREE.Group();
    const body: [number, number, number][] = [];
    for (let index = 0; index < 1_000; index += 1) {
        body.push([(index % 20) / 10 - 1, (index % 50) / 25, (index % 10) / 10 - 0.5]);
    }
    const feet: [number, number, number][] = Array.from({ length: 20 }, (_, index) => [
        index < 10 ? -0.55 : 0.55,
        -0.12,
        (index % 10) / 20 - 0.25,
    ]);
    root.add(pointMesh([...body, ...feet, [0, -25, 0]]));

    const bounds = petModelPresentationBounds(root);
    assert.ok(bounds.groundY <= -0.11);
    assert.ok(bounds.groundY > -1);
});

test("small meshes retain exact bounds instead of overfitting percentiles", () => {
    const root = new THREE.Group();
    root.add(pointMesh([[-2, -1, -3], [4, 5, 6]]));
    const bounds = petModelPresentationBounds(root);
    assert.deepEqual(bounds.fit.min.toArray(), [-2, -1, -3]);
    assert.deepEqual(bounds.fit.max.toArray(), [4, 5, 6]);
    assert.equal(bounds.groundY, -1);
});

test("stable bounds preserve ordinary unskinned meshes", () => {
    const root = new THREE.Group();
    root.add(pointMesh(Array.from({ length: 200 }, (_, index) => [
        (index % 10) / 5 - 1,
        (index % 20) / 10,
        (index % 8) / 8 - 0.5,
    ])));
    const direct = petModelPresentationBounds(root);
    const stable = stablePetModelPresentationBounds(root);
    assert.deepEqual(stable.fit.min.toArray(), direct.fit.min.toArray());
    assert.deepEqual(stable.fit.max.toArray(), direct.fit.max.toArray());
});

test("cloned rotated rigs are grounded from the rendered skin, not a stale bind inverse", () => {
    const source = new THREE.Group();
    const geometry = pointMesh(Array.from({ length: 200 }, (_, index) => [
        (index % 10) / 5 - 1,
        (index % 20) / 10,
        (index % 8) / 8 - 0.5,
    ])).geometry;
    const count = geometry.getAttribute("position").count;
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(
        Array.from({ length: count }, () => [1, 0, 0, 0]).flat(), 4,
    ));
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    mesh.rotation.x = Math.PI / 2;
    const bone = new THREE.Bone();
    source.add(mesh, bone);
    source.updateMatrixWorld(true);
    // GLTFLoader binds to identity; the attached mesh refreshes its inverse
    // during rendering. SkeletonUtils.bind resets that inverse on the clone.
    mesh.bind(new THREE.Skeleton([bone]), new THREE.Matrix4());
    source.updateMatrixWorld(true);
    const expected = stablePetModelPresentationBounds(source);
    const cloned = cloneSkeleton(source);
    const actual = stablePetModelPresentationBounds(cloned);

    assert.ok(Math.abs(actual.groundY - expected.groundY) < 1e-6);
    assert.ok(actual.fit.min.distanceTo(expected.fit.min) < 1e-6);
    assert.ok(actual.fit.max.distanceTo(expected.fit.max) < 1e-6);
    assert.ok(Math.abs(actual.groundY) < 1e-6, "the soles stay at zero after cloning");
});
