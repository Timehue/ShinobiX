/** Lossless, synchronous delivery for the two lazy world geometry registries. */
export function packedWorldData(source) {
    const bytes = Buffer.from(JSON.stringify(JSON.parse(source))), packed = [], positions = new Map();
    for (let i = 0; i < bytes.length;) {
        const key = bytes.subarray(i, i + 4).toString('hex');
        const candidates = positions.get(key) ?? [];
        let length = 0, distance = 0;
        for (let c = candidates.length - 1; c >= Math.max(0, candidates.length - 64); c--) {
            const offset = i - candidates[c];
            if (offset > 65535) break;
            let n = 0;
            while (n < 130 && i + n < bytes.length && bytes[i + n] === bytes[i + n - offset]) n++;
            if (n > length) { length = n; distance = offset; }
        }
        const count = length >= 4 ? length : 1;
        if (length >= 4) packed.push(128 + length - 4, distance >> 8, distance & 255);
        else if (bytes[i] < 128) packed.push(bytes[i]);
        else packed.push(255, bytes[i]);
        for (let n = 0; n < count; n++) {
            const nextKey = bytes.subarray(i + n, i + n + 4).toString('hex');
            const list = positions.get(nextKey) ?? [];
            list.push(i + n);
            if (list.length > 64) list.shift();
            positions.set(nextKey, list);
        }
        i += count;
    }
    // Browser-native UTF-8 decoding, no dependency, fetch, promise or startup preload.
    return `export default JSON.parse((${unpackWorldData.toString()})(${JSON.stringify(Buffer.from(packed).toString('base64'))},${bytes.length}));`;
}

function unpackWorldData(encoded, size) {
    const input = atob(encoded), output = new Uint8Array(size);
    let cursor = 0;
    for (let i = 0; i < input.length;) {
        const token = input.charCodeAt(i++);
        if (token < 128) output[cursor++] = token;
        else if (token === 255) output[cursor++] = input.charCodeAt(i++);
        else {
            const distance = input.charCodeAt(i++) * 256 + input.charCodeAt(i++);
            for (let n = 0; n < token - 128 + 4; n++) {
                output[cursor] = output[cursor - distance];
                cursor++;
            }
        }
    }
    return new TextDecoder().decode(output);
}
