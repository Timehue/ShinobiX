import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compactGlbDelivery } from './compact-glb-delivery.mjs';

function parse(bytes) {
    const length = bytes.readUInt32LE(12);
    return { json: JSON.parse(bytes.subarray(20, 20 + length).toString().trim()), bin: bytes.subarray(28 + length) };
}

// Independent semantic oracle: resolve every live reference into its metadata
// and exact encoded payload. This includes compressed geometry, morph targets,
// sparse accessors, skin bind matrices, images and all animation samplers.
function meaning(bytes) {
    const { json: j, bin } = parse(bytes);
    const view = id => {
        const v = structuredClone(j.bufferViews[id]);
        if (v.buffer === 0) v.payload = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength).toString('base64');
        const m = v.extensions?.EXT_meshopt_compression;
        if (m) {
            assert.equal(m.buffer, 0);
            m.payload = bin.subarray(m.byteOffset ?? 0, (m.byteOffset ?? 0) + m.byteLength).toString('base64');
            delete m.byteOffset;
        }
        // Physical positions are irrelevant after resolving the payload.
        if (v.buffer === 0) delete v.byteOffset;
        return v;
    };
    const accessor = id => {
        const a = structuredClone(j.accessors[id]);
        if (a.bufferView !== undefined) a.bufferView = view(a.bufferView);
        if (a.sparse) { a.sparse.indices.bufferView = view(a.sparse.indices.bufferView); a.sparse.values.bufferView = view(a.sparse.values.bufferView); }
        return a;
    };
    for (const mesh of j.meshes ?? []) for (const p of mesh.primitives ?? []) {
        if (p.indices !== undefined) p.indices = accessor(p.indices);
        for (const key of Object.keys(p.attributes ?? {})) p.attributes[key] = accessor(p.attributes[key]);
        for (const t of p.targets ?? []) for (const key of Object.keys(t)) t[key] = accessor(t[key]);
    }
    for (const s of j.skins ?? []) if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = accessor(s.inverseBindMatrices);
    for (const a of j.animations ?? []) for (const s of a.samplers ?? []) { s.input = accessor(s.input); s.output = accessor(s.output); }
    for (const im of j.images ?? []) if (im.bufferView !== undefined) im.bufferView = view(im.bufferView);
    delete j.accessors; delete j.bufferViews; delete j.buffers[0].byteLength;
    return j;
}

test('all 320 selected pet GLBs retain exact live geometry, textures, skins and animation payloads', () => {
    const root = fileURLToPath(new URL('../public/', import.meta.url));
    const manifest = JSON.parse(fs.readFileSync(root + 'pet-models/warfront-lod/manifest.json', 'utf8'));
    let saved = 0, changed = 0;
    for (const entry of manifest.entries) for (const url of [entry.sourceUrl, entry.lodUrl]) {
        const file = root + url.split('?')[0].replace(/^\//, '');
        const source = fs.readFileSync(file), original = Buffer.from(source);
        const result = compactGlbDelivery(source);
        assert.ok(source.equals(original), `${url}: input mutated`);
        assert.deepEqual(meaning(result), meaning(source), `${url}: live asset changed`);
        assert.ok(compactGlbDelivery(result).equals(result), `${url}: not deterministic/idempotent`);
        saved += source.length - result.length;
        changed += Number(!source.equals(result));
    }
    assert.equal(manifest.entries.length * 2, 320);
    assert.ok(changed > 0);
    assert.ok(saved > 3 * 1024 * 1024, `Only ${saved} obsolete bytes removed`);
});

test('unknown extension references pass through without stripping', () => {
    const root = fileURLToPath(new URL('../public/', import.meta.url));
    const source = fs.readFileSync(root + 'pet-models/roster/legendary-10.glb');
    // Same byte count: replace a known extension with an unknown name.
    const unknown = Buffer.from(source.toString('latin1').replaceAll('KHR_mesh_quantization', 'FOO_mesh_quantization'), 'latin1');
    assert.ok(compactGlbDelivery(unknown).equals(unknown));
});
