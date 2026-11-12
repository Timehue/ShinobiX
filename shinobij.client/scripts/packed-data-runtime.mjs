import { inflateSync } from 'fflate';

// Printable base85 digits that can be embedded directly in a JavaScript string.
export const digits = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+,-./:;=?@[]^_{';
const values = new Uint8Array(128);
for (let i=0;i<digits.length;i++) values[digits.charCodeAt(i)] = i;

/** Restore a build-packed UTF-8 catalog before its synchronous consumers run. */
export function unpackWorldData(encoded, size) {
    const compressed = new Uint8Array(Math.floor(encoded.length*4/5));
    for (let i=0, offset=0; i<encoded.length; i+=5, offset+=4) {
        let word = 0;
        for (let j=0; j<5; j++) word = word*85 + (i+j<encoded.length ? values[encoded.charCodeAt(i+j)] : 84);
        for (let j=0; j<4 && offset+j<compressed.length; j++) compressed[offset+j] = word >>> (24-j*8);
    }
    const bytes = inflateSync(compressed, { out: new Uint8Array(size) });
    if (bytes.length !== size) throw new Error('Invalid world data length');
    return new TextDecoder().decode(bytes);
}
