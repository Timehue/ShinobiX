import { createHash } from 'node:crypto';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { align4, encodeStudioGlb, readStudioAccessor } from './pet-studio-glb.mjs';

/** Copy reviewed clips between the same rig without rewriting mesh or atlas bytes. */
export async function copyReviewedPetClips(target, donor, clipNames, { allowTrackReduction = false } = {}) {
    await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
    const json = structuredClone(target.json), streams = [], nodeMap = new Map();
    const bind = n => ({ translation: n.translation ?? [0, 0, 0], rotation: n.rotation ?? [0, 0, 0, 1], scale: n.scale ?? [1, 1, 1], matrix: n.matrix });
    const mappedNode = index => {
        if (nodeMap.has(index)) return nodeMap.get(index);
        const node = donor.json.nodes[index];
        const matches = json.nodes.flatMap((n, i) => n.name === node.name ? [i] : []);
        if (!node.name || matches.length !== 1) throw Error('Ambiguous animated joint: ' + node.name);
        const mapped = matches[0];
        if (JSON.stringify(bind(node)) !== JSON.stringify(bind(json.nodes[mapped]))) throw Error('Incompatible joint bind: ' + node.name);
        const parentName = (nodes, i) => nodes.find(n => n.children?.includes(i))?.name;
        if (parentName(donor.json.nodes, index) !== parentName(json.nodes, mapped)) throw Error('Incompatible joint parent: ' + node.name);
        nodeMap.set(index, mapped); return mapped;
    };
    const accessors = new Map();
    const copyAccessor = async index => {
        if (accessors.has(index)) return accessors.get(index);
        const original = donor.json.accessors[index];
        if (original.sparse) throw Error('Sparse animation accessor is unsupported');
        const { values, width } = await readStudioAccessor(donor.json, donor.bin, index);
        const accessor = { componentType: 5126, count: values.length / width, type: original.type, ...(original.min ? { min: original.min } : {}), ...(original.max ? { max: original.max } : {}) };
        const mapped = json.accessors.length; json.accessors.push(accessor); accessors.set(index, mapped);
        streams.push({ accessor, width, bytes: Buffer.from(values.buffer, values.byteOffset, values.byteLength) }); return mapped;
    };
    for (const name of clipNames) {
        const source = donor.json.animations.find(a => a.name === name), slot = json.animations.findIndex(a => a.name === name);
        if (!source || slot < 0) throw Error('Missing reviewed clip: ' + name);
        const replacement = structuredClone(source);
        for (const channel of replacement.channels) channel.target.node = mappedNode(channel.target.node);
        const tracks = new Set(replacement.channels.map(c => c.target.node + ':' + c.target.path));
        if (tracks.size !== replacement.channels.length || (!allowTrackReduction && json.animations[slot].channels.some(c => !tracks.has(c.target.node + ':' + c.target.path)))) throw Error('Reviewed clip loses or duplicates a track: ' + name);
        for (const sampler of replacement.samplers) { sampler.input = await copyAccessor(sampler.input); sampler.output = await copyAccessor(sampler.output); }
        json.animations[slot] = replacement;
    }
    const chunks = [target.bin]; let byteLength = target.bin.length;
    let fallback = json.buffers.findIndex(b => b.extensions?.EXT_meshopt_compression?.fallback);
    if (fallback < 0) { fallback = json.buffers.length; json.buffers.push({ byteLength: 0, extensions: { EXT_meshopt_compression: { fallback: true } } }); }
    for (const width of [1, 3, 4]) {
        const group = streams.filter(s => s.width === width); if (!group.length) continue;
        const bytes = Buffer.concat(group.map(s => s.bytes)), stride = width * 4;
        const values = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        const filter = width === 1 ? undefined : 'EXPONENTIAL';
        const filtered = filter ? MeshoptEncoder.encodeFilterExp(values, bytes.length / stride, stride, 22, 'SharedComponent') : bytes;
        const compressed = MeshoptEncoder.encodeGltfBuffer(filtered, bytes.length / stride, stride, 'ATTRIBUTES');
        const decoded = new Uint8Array(bytes.length); MeshoptDecoder.decodeGltfBuffer(decoded, bytes.length / stride, stride, compressed, 'ATTRIBUTES', filter);
        const actual = new Float32Array(decoded.buffer);
        if (width === 1 ? !Buffer.from(decoded).equals(bytes) : values.some((v, i) => Math.abs(v - actual[i]) > .00002)) throw Error('Copied motion exceeded precision budget');
        const padding = align4(byteLength) - byteLength; if (padding) chunks.push(Buffer.alloc(padding)); byteLength += padding;
        const virtualOffset = align4(json.buffers[fallback].byteLength); json.buffers[fallback].byteLength = virtualOffset + bytes.length;
        let offset = 0;
        for (const stream of group) { stream.accessor.bufferView = json.bufferViews.length; stream.accessor.byteOffset = offset; offset += stream.bytes.length; }
        json.bufferViews.push({ buffer: fallback, byteOffset: virtualOffset, byteLength: bytes.length, byteStride: stride, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: byteLength, byteLength: compressed.length, byteStride: stride, count: bytes.length / stride, mode: 'ATTRIBUTES', ...(filter ? { filter } : {}) } } });
        chunks.push(Buffer.from(compressed)); byteLength += compressed.length;
    }
    for (const key of ['extensionsUsed', 'extensionsRequired']) { json[key] ??= []; if (!json[key].includes('EXT_meshopt_compression')) json[key].push('EXT_meshopt_compression'); }
    json.buffers[0].byteLength = byteLength;
    json.extras ??= {}; json.extras.motionPairSync = { revision: '20261014-reviewed-pair-v1', clips: clipNames, preservedPayloadBytes: target.bin.length, preservedPayloadSha256: createHash('sha256').update(target.bin).digest('hex') };
    return encodeStudioGlb(json, Buffer.concat(chunks));
}
