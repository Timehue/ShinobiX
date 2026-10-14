import { MeshoptDecoder } from 'meshoptimizer';

export const align4 = n => (n + 3) & ~3;
export function parseStudioGlb(bytes) {
    if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) throw Error('Expected GLB 2.0');
    const length = bytes.readUInt32LE(12);
    return { json: JSON.parse(bytes.subarray(20, 20 + length)), bin: bytes.subarray(28 + length, 28 + length + bytes.readUInt32LE(20 + length)) };
}
export function encodeStudioGlb(json, bin) {
    const text = Buffer.from(JSON.stringify(json)), length = align4(text.length), binaryLength = align4(bin.length);
    const bytes = Buffer.alloc(28 + length + binaryLength);
    bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
    bytes.writeUInt32LE(length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); bytes.fill(32, 20, 20 + length); text.copy(bytes, 20);
    bytes.writeUInt32LE(binaryLength, 20 + length); bytes.writeUInt32LE(0x004e4942, 24 + length); bin.copy(bytes, 28 + length);
    return bytes;
}
export async function readStudioAccessor(json, bin, index) {
    await MeshoptDecoder.ready;
    const a = json.accessors[index], v = json.bufferViews[a.bufferView];
    const width = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
    const layout = { 5120: [1, 'getInt8', 127], 5121: [1, 'getUint8', 255], 5122: [2, 'getInt16', 32767], 5123: [2, 'getUint16', 65535], 5126: [4, 'getFloat32', 1] }[a.componentType];
    if (!layout || !width) throw Error('Unsupported motion accessor');
    const [bytesPerComponent, read, divisor] = layout, ext = v.extensions?.EXT_meshopt_compression;
    let bytes = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength), stride = v.byteStride ?? width * bytesPerComponent;
    if (ext) {
        bytes = new Uint8Array(ext.count * ext.byteStride); stride = ext.byteStride;
        MeshoptDecoder.decodeGltfBuffer(bytes, ext.count, ext.byteStride, bin.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength), ext.mode, ext.filter);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width, values: Float32Array.from({ length: a.count * width }, (_, i) => {
        const n = view[read]((a.byteOffset ?? 0) + Math.floor(i / width) * stride + i % width * bytesPerComponent, true);
        return a.normalized ? Math.max(-1, n / divisor) : n;
    }) };
}
