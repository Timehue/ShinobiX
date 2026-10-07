import assert from 'node:assert/strict';

const supported = new Set(['EXT_meshopt_compression', 'EXT_texture_webp', 'KHR_mesh_quantization', 'KHR_materials_specular']);
const align4 = n => Math.ceil(n / 4) * 4;

/** Strip unreachable accessor/view records left by animation authoring.
 * Copies live binary payloads verbatim; never decodes or recompresses them.
 * Unsupported extensions pass through because they may own additional references.
 */
export function compactGlbDelivery(source) {
    assert.equal(source.readUInt32LE(0), 0x46546c67);
    assert.equal(source.readUInt32LE(4), 2);
    assert.equal(source.readUInt32LE(8), source.length);
    const jsonLength = source.readUInt32LE(12);
    assert.equal(source.readUInt32LE(16), 0x4e4f534a);
    const json = JSON.parse(source.subarray(20, 20 + jsonLength).toString().trim());
    const unknownExtension = value => value && typeof value === 'object' && (
        Object.keys(value.extensions ?? {}).some(name => !supported.has(name))
        || Object.values(value).some(child => unknownExtension(child))
    );
    if ((json.extensionsUsed ?? []).some(name => !supported.has(name)) || unknownExtension(json)) return source;
    const binHeader = 20 + jsonLength;
    if (binHeader + 8 > source.length || source.readUInt32LE(binHeader + 4) !== 0x004e4942) return source;
    const binary = source.subarray(binHeader + 8);
    assert.equal(binary.length, source.readUInt32LE(binHeader));
    if (!json.buffers?.length || json.buffers[0].uri || json.buffers.slice(1).some(b => b.uri || !b.extensions?.EXT_meshopt_compression?.fallback)) return source;

    const accessorRefs = [];
    const viewRefs = [];
    const ref = (owner, key, refs) => { if (owner?.[key] !== undefined) refs.push([owner, key]); };
    for (const mesh of json.meshes ?? []) for (const p of mesh.primitives ?? []) {
        ref(p, 'indices', accessorRefs);
        for (const key of Object.keys(p.attributes ?? {})) ref(p.attributes, key, accessorRefs);
        for (const target of p.targets ?? []) for (const key of Object.keys(target)) ref(target, key, accessorRefs);
    }
    for (const skin of json.skins ?? []) ref(skin, 'inverseBindMatrices', accessorRefs);
    for (const animation of json.animations ?? []) for (const sampler of animation.samplers ?? []) {
        ref(sampler, 'input', accessorRefs);
        ref(sampler, 'output', accessorRefs);
    }
    const liveAccessors = new Set(accessorRefs.map(([owner, key]) => owner[key]));
    for (const index of liveAccessors) {
        const accessor = json.accessors[index];
        assert.ok(accessor, `Missing accessor ${index}`);
        ref(accessor, 'bufferView', viewRefs);
        ref(accessor.sparse?.indices, 'bufferView', viewRefs);
        ref(accessor.sparse?.values, 'bufferView', viewRefs);
    }
    for (const image of json.images ?? []) ref(image, 'bufferView', viewRefs);
    const liveViews = new Set(viewRefs.map(([owner, key]) => owner[key]));
    if (liveAccessors.size === (json.accessors?.length ?? 0) && liveViews.size === (json.bufferViews?.length ?? 0)) return source;

    const retain = (items, live, refs) => {
        const mapping = new Map();
        const kept = items.filter((_, index) => { if (!live.has(index)) return false; mapping.set(index, mapping.size); return true; });
        for (const [owner, key] of refs) { assert.ok(mapping.has(owner[key])); owner[key] = mapping.get(owner[key]); }
        return kept;
    };
    json.accessors = retain(json.accessors ?? [], liveAccessors, accessorRefs);
    json.bufferViews = retain(json.bufferViews ?? [], liveViews, viewRefs);
    const chunks = [];
    let size = 0;
    const copy = (owner) => {
        if (owner.buffer !== 0) return;
        const start = owner.byteOffset ?? 0;
        assert.ok(start >= 0 && start + owner.byteLength <= json.buffers[0].byteLength);
        const offset = align4(size);
        chunks.push({ offset, bytes: binary.subarray(start, start + owner.byteLength) });
        owner.byteOffset = offset;
        size = offset + owner.byteLength;
    };
    for (const view of json.bufferViews) {
        copy(view);
        if (view.extensions?.EXT_meshopt_compression) copy(view.extensions.EXT_meshopt_compression);
    }
    json.buffers[0].byteLength = size;
    const text = Buffer.from(JSON.stringify(json));
    const textSize = align4(text.length), binSize = align4(size);
    const result = Buffer.alloc(28 + textSize + binSize);
    result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
    result.writeUInt32LE(textSize, 12); result.writeUInt32LE(0x4e4f534a, 16);
    result.fill(0x20, 20, 20 + textSize); text.copy(result, 20);
    result.writeUInt32LE(binSize, 20 + textSize); result.writeUInt32LE(0x004e4942, 24 + textSize);
    for (const { offset, bytes } of chunks) bytes.copy(result, 28 + textSize + offset);
    return result.length < source.length ? result : source;
}
