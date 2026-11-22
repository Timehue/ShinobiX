import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { COAST_CAST, COAST_CAST_PORTRAITS, coastCastPortrait } from './coast-cast.js';

const publicDir = fileURLToPath(new URL('../shinobij.client/public/', import.meta.url));
const folder = join(publicDir, 'portraits/cinematic/coast');

const expectedFile = (id: string) => id === 'brinejaw' ? 'brinejaw-v2.webp' : `${id}-v1.webp`;

/** WebP canvas size straight from the header, so the unit suite needs no image library. */
function sizeOfWebp(file: string): [number, number] | null {
    const b = readFileSync(file);
    if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8X') return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
    if (kind === 'VP8L') { const bits = b.readUInt32LE(21); return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1]; }
    if (kind === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    return null;
}

test('every listed coast portrait is a cast member with a cut-out of the agreed size', () => {
    assert.equal(new Set(COAST_CAST_PORTRAITS).size, COAST_CAST_PORTRAITS.length, 'no id is listed twice');
    for (const id of COAST_CAST_PORTRAITS) {
        assert.ok(COAST_CAST[id], `${id} is not in the cast`);
        const path = coastCastPortrait(id);
        assert.equal(path, `/portraits/cinematic/coast/${expectedFile(id)}`);
        const file = join(publicDir, path!);
        assert.ok(existsSync(file), `${id} is listed but has no painting`);
        // Waist-up cut-outs at this size need no crop table on the client (lib/vn-portrait-framing).
        assert.deepEqual(sizeOfWebp(file), [733, 1100], `${id} must be 733 x 1100`);
        // A cut-out carries alpha, which is the extended WebP container.
        assert.equal(readFileSync(file).toString('ascii', 12, 16), 'VP8X', `${id} must be a transparent cut-out`);
        assert.ok(statSync(file).size <= 130_000, `${id} is over 130,000 bytes`);
    }
});

test('no painting sits in the folder unlisted, where no scene would ever show it', () => {
    const files = existsSync(folder) ? readdirSync(folder).filter(name => name.endsWith('.webp')) : [];
    assert.deepEqual(files.sort(), COAST_CAST_PORTRAITS.map(expectedFile).sort());
});

test('the Sage keeps the cut-out he already has, and an unlisted member has none', () => {
    const sage = coastCastPortrait('wandering-sage');
    assert.ok(sage && existsSync(join(publicDir, sage)), 'the Sage’s existing cut-out');
    assert.equal(COAST_CAST_PORTRAITS.includes('wandering-sage'), false, 'he is not repainted for the coast');
    const unlisted = Object.keys(COAST_CAST).find(id => id !== 'wandering-sage' && !COAST_CAST_PORTRAITS.includes(id));
    if (unlisted) assert.equal(coastCastPortrait(unlisted), undefined);
    assert.equal(coastCastPortrait('nobody'), undefined);
});
