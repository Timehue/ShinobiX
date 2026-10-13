import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { THUMB_DIR, THUMB_PX, floorArtHashes, thumbFileName } from './gen-sector-map-thumbs.mjs';

function webpSize(file) {
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', `${file} is not a WebP file`);
    const chunk = bytes.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
    if (chunk === 'VP8L') {
        const bits = bytes.readUInt32LE(21);
        return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
    }
    return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
}

test('every reviewed floor painting has a current card-sized copy', () => {
    const hashes = floorArtHashes();
    assert.ok(hashes.size > 0);
    const wanted = new Set();
    for (const [artKey, sha256] of hashes) {
        const name = thumbFileName(artKey, sha256);
        wanted.add(name);
        const file = path.join(THUMB_DIR, name);
        assert.ok(fs.existsSync(file), `missing or stale sector-map/thumbs/${name}; run node scripts/gen-sector-map-thumbs.mjs`);
        const [width, height] = webpSize(file);
        assert.ok(width <= THUMB_PX && height <= THUMB_PX, `${name} is ${width}x${height}`);
    }
    const stale = fs.readdirSync(THUMB_DIR).filter((file) => !wanted.has(file));
    assert.deepEqual(stale, [], 'thumbnails of replaced paintings');
});

test('the client names thumbnails the way the generator writes them', () => {
    const source = fs.readFileSync(new URL('../src/lib/sector-floor-layout.ts', import.meta.url), 'utf8');
    assert.match(source, /`\/sector-map\/thumbs\/s\$\{key\}-\$\{hash\.slice\(0, 12\)\}\.webp`/);
    assert.equal(thumbFileName(7, 'abcdef0123456789'), 's7-abcdef012345.webp');
});
