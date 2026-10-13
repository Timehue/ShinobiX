import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute } from 'three';
import { repairPetSkinWeights, repairPetSkinEdges, packContinuousPetSkinWeights } from './pet-skin-weight-repair';

function strip() {
    const geometry = new BufferGeometry(), positions: number[] = [], joints: number[] = [], weights: number[] = [], triangles: number[] = [];
    for (let x = 0; x < 24; x++) for (let y = 0; y < 2; y++) {
        positions.push(x / 24, y * .02, 0); joints.push(x < 12 ? 0 : 1, 0, 0, 0); weights.push(1, 0, 0, 0);
        if (x && y) { const v = x * 2; triangles.push(v - 2, v, v + 1, v - 2, v + 1, v - 1); }
    }
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(joints, 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4)); geometry.setIndex(triangles);
    return geometry;
}

test('a joint boundary becomes continuous without changing mesh positions, topology, or cached source weights', () => {
    const source = strip(), before = Array.from(source.getAttribute('skinWeight').array), repair = repairPetSkinWeights(source, 2)!;
    const weightAt = (v: number, joint: number) => { let sum = 0; for (let i = 0; i < 4; i++) if (repair.geometry.getAttribute('skinIndex').getComponent(v, i) === joint) sum += repair.geometry.getAttribute('skinWeight').getComponent(v, i); return sum; };
    assert.ok(Math.abs(weightAt(22, 0) - weightAt(24, 0)) < .2, 'adjacent vertices must share the joint transition rather than pull apart');
    assert.deepEqual(repair.geometry.getAttribute('position').array, source.getAttribute('position').array);
    assert.deepEqual(repair.geometry.index!.array, source.index!.array);
    assert.deepEqual(Array.from(source.getAttribute('skinWeight').array), before);
    for (let v = 0; v < 48; v++) assert.ok(Math.abs(weightAt(v, 0) + weightAt(v, 1) - 1) < 1e-6);
});

test('rigid skull-bound detail keeps its full binding through diffusion', () => {
    const source = strip(), repair = repairPetSkinWeights(source, 2, 1)!;
    for (let v = 24; v < 48; v++) {
        assert.equal(repair.geometry.getAttribute('skinIndex').getX(v), 1);
        assert.equal(repair.geometry.getAttribute('skinWeight').getX(v), 1);
    }
});

test('connected residual seam edges receive a common palette with normalized weights', () => {
    const source = strip(), repaired = repairPetSkinEdges(source, 2, [[22, 24], [24, 26]]).geometry;
    for (const v of [22, 24, 26]) {
        assert.equal(repaired.getAttribute('skinIndex').getX(v), repaired.getAttribute('skinIndex').getX(22));
        assert.equal(repaired.getAttribute('skinWeight').getX(v), repaired.getAttribute('skinWeight').getX(22));
        assert.ok(Math.abs(Array.from({ length: 4 }, (_, i) => repaired.getAttribute('skinWeight').getComponent(v, i)).reduce((a, b) => a + b, 0) - 1) < 1e-6);
    }
});

test('local seam repairs retain rigid skull details in the seam and its adjacent triangles', () => {
    const source = strip(), repaired = repairPetSkinEdges(source, 2, [[22, 24]], 1).geometry;
    for (let v = 24; v < 48; v++) {
        assert.equal(repaired.getAttribute('skinIndex').getX(v), 1);
        assert.equal(repaired.getAttribute('skinWeight').getX(v), 1);
    }
    assert.equal(repaired.getAttribute('skinIndex').getX(22), 1);
    assert.equal(repaired.getAttribute('skinWeight').getX(22), 1);
    assert.equal(source.getAttribute('skinIndex').getX(22), 0, 'the original binding remains untouched');
});

test('feathered triangle neighbors keep the same binding across UV duplicate vertices', () => {
    const source = strip(), duplicateOf = 21, duplicate = 48;
    const positions = source.getAttribute('position'), joints = source.getAttribute('skinIndex'), weights = source.getAttribute('skinWeight');
    source.setAttribute('position', new Float32BufferAttribute([...positions.array, positions.getX(duplicateOf), positions.getY(duplicateOf), positions.getZ(duplicateOf)], 3));
    source.setAttribute('skinIndex', new Uint16BufferAttribute([...joints.array, 0, 0, 0, 0], 4));
    source.setAttribute('skinWeight', new Float32BufferAttribute([...weights.array, 1, 0, 0, 0], 4));
    source.setIndex([...source.index!.array, 20, 22, duplicate]);
    const repaired = repairPetSkinEdges(source, 2, [[22, 24]]).geometry;
    for (let slot = 0; slot < 4; slot++) {
        assert.equal(repaired.getAttribute('skinIndex').getComponent(duplicateOf, slot), repaired.getAttribute('skinIndex').getComponent(duplicate, slot));
        assert.equal(repaired.getAttribute('skinWeight').getComponent(duplicateOf, slot), repaired.getAttribute('skinWeight').getComponent(duplicate, slot));
    }
    assert.notEqual(repaired.getAttribute('skinWeight').getX(duplicateOf), 1, 'the otherwise untouched UV copy must receive its neighbor\'s correction');
});

test('crossing the four-influence palette boundary cannot pop between opposite moving bones', () => {
    const translatedPose = (values: number[]) => {
        const packed = packContinuousPetSkinWeights(values);
        return packed.joints.reduce((position, joint, slot) => position + packed.weights[slot] * [0, 0, 0, -1, 1][joint], 0);
    };
    const left = translatedPose([.5, .2, .1, .1001, .0999]);
    const right = translatedPose([.5, .2, .1, .0999, .1001]);
    assert.ok(Math.abs(right - left) < .001, 'a tiny weight change must produce a tiny posed-vertex change');
});

test('measured fine creases seed diffusion even below the automatic hard-boundary threshold', () => {
    const source = strip();
    for (let v = 0; v < 48; v++) {
        source.getAttribute('skinIndex').setXYZW(v, 0, 1, 0, 0);
        source.getAttribute('skinWeight').setXYZW(v, v < 24 ? .51 : .49, v < 24 ? .49 : .51, 0, 0);
    }
    const repaired = repairPetSkinWeights(source, 2, -1, 48, [[22, 24]])!.geometry;
    assert.ok(Math.abs(repaired.getAttribute('skinWeight').getX(22) - repaired.getAttribute('skinWeight').getX(24)) < .005);
    assert.deepEqual(repaired.getAttribute('position').array, source.getAttribute('position').array);
});

test('a repair also closes unequal connected UV copies outside the measured edge neighborhood', () => {
    const source = strip(), original = 21, duplicate = 48;
    const position = source.getAttribute('position');
    source.setAttribute('position', new Float32BufferAttribute([...position.array, position.getX(original), position.getY(original), position.getZ(original)], 3));
    source.setAttribute('skinIndex', new Uint16BufferAttribute([...source.getAttribute('skinIndex').array, 1, 0, 0, 0], 4));
    source.setAttribute('skinWeight', new Float32BufferAttribute([...source.getAttribute('skinWeight').array, 1, 0, 0, 0], 4));
    const indices = [...source.index!.array], corner = indices.indexOf(original);
    source.setIndex(indices.map((v, i) => i === corner ? duplicate : v));
    const repaired = repairPetSkinEdges(source, 2, [[40, 42]]).geometry;
    for (let slot = 0; slot < 4; slot++) {
        assert.equal(repaired.getAttribute('skinIndex').getComponent(original, slot), repaired.getAttribute('skinIndex').getComponent(duplicate, slot));
        assert.equal(repaired.getAttribute('skinWeight').getComponent(original, slot), repaired.getAttribute('skinWeight').getComponent(duplicate, slot));
    }
    assert.notEqual(repaired.getAttribute('skinWeight').getX(original), 1);
});
