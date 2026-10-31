/** Shared, synchronous decoder for build-packed catalogs and world geometry. */
export function unpackWorldData(encoded, size) {
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
