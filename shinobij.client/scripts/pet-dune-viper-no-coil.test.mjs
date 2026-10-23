import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {Vector3} from 'three';
import {fitDuneViperNoCoilSkin} from './lib/pet-dune-viper-no-coil-skin.mjs';
import {rebuildDuneViperNoCoil} from './lib/pet-dune-viper-no-coil.mjs';
import {parseStudioGlb} from './lib/pet-studio-glb.mjs';
import {loadPetDeformationProbeBytes} from './lib/pet-deformation-probe.mjs';

const fixture = new URL('./fixtures/pet-dune-viper-no-coil-20261021/', import.meta.url);
const authored = JSON.parse(gunzipSync(await readFile(new URL('authored-geometry.json.gz', fixture))));
const fitted = fitDuneViperNoCoilSkin(authored);
const before = await readFile(new URL('source-before-remake.glb', fixture));
const texture = await readFile(new URL('lean-texture.webp', fixture));

test('distal limbs cannot inherit the removed coil, including the missed rear ankle patch', () => {
    let badBefore = 0, checked = 0;
    for (let f = 0; f < fitted.faces.length; f++) for (let c = 0; c < 3; c++) {
        const [x, y, z] = fitted.vertices[fitted.faces[f][c]];
        if (y >= -.38 || z < -.31) continue;
        const own = z > .04 ? (x < 0 ? [9,10,11] : [6,7,8]) : (x < 0 ? [18,19,20] : [15,16,17]);
        const share = weights => weights.reduce((sum, [joint, weight]) => sum + (own.includes(joint) ? weight : 0), 0);
        if (authored.weights[f][c].some(([joint, weight]) => [12,13,14].includes(joint) && weight > .01)) badBefore++;
        for (const [joint, weight] of fitted.weights[f][c]) {
            assert.ok(weight < 1e-6 || joint === 1 || own.includes(joint), 'ankle inherited the coil or another limb');
        }
        if (y < -.43) {
            assert.ok(share(fitted.weights[f][c]) > .99999, `foot ${x},${y},${z} follows another body part`);
            checked++;
        }
    }
    assert.ok(badBefore > 0, 'negative control must retain the old coil contamination');
    assert.ok(checked > 2000, 'all four sculpted feet need coverage');
    assert.deepEqual(fitted.vertices, authored.vertices);
    assert.deepEqual(fitted.faces, authored.faces);
    assert.deepEqual(fitted.uv, authored.uv);
    let tailVertices = 0;
    for (let f = 0; f < fitted.faces.length; f++) for (let c = 0; c < 3; c++) {
        if (fitted.vertices[fitted.faces[f][c]][2] >= -.45) continue;
        const share = fitted.weights[f][c].reduce((sum, [joint, weight]) => sum + ([12,13,14].includes(joint) ? weight : 0), 0);
        assert.ok(share > .99999, 'new tail lost its dedicated chain');
        tailVertices++;
    }
    assert.ok(tailVertices > 1000, 'tail needs complete skin coverage');
});

test('the rear tail has one closed section and a progressively narrower single taper', () => {
    const torso = authored.vertices.filter(([,y,z]) => y < -.15 && Math.abs(z) < .03);
    const span = axis => Math.max(...torso.map(p => p[axis])) - Math.min(...torso.map(p => p[axis]));
    assert.ok(torso.length > 20, 'the central torso needs geometric coverage');
    assert.ok(span(0) < .31 && span(1) < .22, 'the rejected broad/deep torso returned');
    let previousWidth = Infinity;
    for (const plane of [-.413, -.527, -.641, -.713]) {
        const adjacency = new Map(), points = [];
        const key = p => p.map(v => Math.round(v * 1e5)).join(',');
        for (const face of authored.faces) {
            const intersections = [];
            for (let k = 0; k < 3; k++) {
                const a = authored.vertices[face[k]], b = authored.vertices[face[(k + 1) % 3]];
                if ((a[2] < plane) === (b[2] < plane)) continue;
                const t = (plane - a[2]) / (b[2] - a[2]);
                intersections.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
            }
            if (intersections.length !== 2) continue;
            const [a, b] = intersections.map(key);
            if (a === b) continue;
            points.push(...intersections);
            for (const [from, to] of [[a,b],[b,a]]) {
                if (!adjacency.has(from)) adjacency.set(from, new Set());
                adjacency.get(from).add(to);
            }
        }
        assert.ok(adjacency.size > 10, 'tail section is missing');
        const visited = new Set(), pending = [adjacency.keys().next().value];
        while (pending.length) {
            const at = pending.pop();
            if (visited.has(at)) continue;
            visited.add(at);
            for (const next of adjacency.get(at)) pending.push(next);
        }
        assert.equal(visited.size, adjacency.size, 'a second tail section or coil remains');
        for (const neighbors of adjacency.values()) assert.equal(neighbors.size, 2, 'tail has an open cut');
        const width = Math.max(...points.map(p => p[0])) - Math.min(...points.map(p => p[0]));
        assert.ok(width < previousWidth && width < .30, 'tail thickens or folds back');
        previousWidth = width;
    }
});

test('the remake is reproducible and retains all thirteen performances and original head pixels', async () => {
    const bytes = await rebuildDuneViperNoCoil(before, authored, texture);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), '99576c778214596fd055148b3ce0cb26ef2f5f112f521b3fe0a5c60d3232bb2b');
    const old = parseStudioGlb(before), next = parseStudioGlb(bytes);
    assert.equal(next.json.animations.length, 13);
    const originalMotion = await loadPetDeformationProbeBytes(before), newMotion = await loadPetDeformationProbeBytes(bytes);
    for (const [name, position] of [['tail_1',[0,-.29,-.34]], ['tail_2',[.02,-.30,-.54]], ['tail_3',[.04,-.29,-.73]]]) {
        const bone = newMotion.meshes[0].skeleton.bones.find(b => b.name === name);
        assert.ok(bone.getWorldPosition(new Vector3()).distanceTo(new Vector3(...position)) < 1e-6,
            `${name} still follows the obsolete coil's rig frame`);
    }
    for (let c = 0; c < originalMotion.animations.length; c++) {
        const a = originalMotion.animations[c], b = newMotion.animations[c];
        assert.equal(b.name, a.name);
        assert.equal(b.duration, a.duration);
        assert.equal(b.tracks.length, a.tracks.length);
        for (let t = 0; t < a.tracks.length; t++) {
            const oldTrack = a.tracks[t], newTrack = b.tracks[t];
            assert.equal(newTrack.name, oldTrack.name);
            assert.deepEqual(newTrack.times, oldTrack.times);
            assert.equal(newTrack.getInterpolation(), oldTrack.getInterpolation());
            for (let i = 0; i < oldTrack.values.length; i++) {
                const lift = oldTrack.name === 'root.position' && i % 3 === 1 ? .003 : 0;
                assert.equal(newTrack.values[i], Math.fround(oldTrack.values[i] + lift),
                    `${a.name}/${oldTrack.name}: authored motion changed`);
            }
        }
    }
    const image = glb => {
        const view = glb.json.bufferViews[glb.json.images[0].bufferView];
        return glb.bin.subarray(view.byteOffset, view.byteOffset + view.byteLength);
    };
    const originalPixels = await sharp(image(old)).removeAlpha().raw().toBuffer();
    const retainedPixels = await sharp(image(next)).extract({left:0, top:0, width:2048, height:2048}).removeAlpha().raw().toBuffer();
    assert.ok(originalPixels.equals(retainedPixels), 'existing head texture pixels changed');
    await assert.rejects(rebuildDuneViperNoCoil(Buffer.from('wrong input'), authored, texture), /Unexpected pre-remake Viper/);
});
