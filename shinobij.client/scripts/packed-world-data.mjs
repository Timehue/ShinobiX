import { deflateRawSync } from 'node:zlib';
import { digits } from './packed-data-runtime.mjs';
import { fileURLToPath } from 'node:url';

export const PACKED_DATA_RUNTIME = new URL('./packed-data-runtime.mjs', import.meta.url);
export const PACKED_DATA_IMPORT = `import { unpackWorldData as __unpackWorldData } from ${JSON.stringify(fileURLToPath(PACKED_DATA_RUNTIME).replace(/\\/g, '/'))};`;

/** Lossless, synchronous delivery for world geometry and static catalogs. */
export function packedDataExpression(source) {
    const bytes = Buffer.from(JSON.stringify(JSON.parse(source)));
    const compressed = deflateRawSync(bytes, { level: 9 });
    let packed = '';
    for (let i=0; i<compressed.length; i+=4) {
        let word=0, group='';
        for (let j=0; j<4; j++) word=word*256+(compressed[i+j] ?? 0);
        for (let j=0; j<5; j++) {
            group=digits[word%85]+group;
            word=Math.floor(word/85);
        }
        packed+=group.slice(0,Math.min(5,compressed.length-i+1));
    }
    return `JSON.parse(__unpackWorldData(${JSON.stringify(packed)},${bytes.length}))`;
}

export function packedWorldData(source) {
    return `${PACKED_DATA_IMPORT}\nexport default ${packedDataExpression(source)};`;
}
