import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FLOOR_ART_SHA256, LANDMARK_ART_SHA256, SECTOR_FLOOR_LAYOUTS } from '../shared/sector-floor-layouts.js';

test('every admitted walk mask matches its delivered painting bytes', () => {
    assert.deepEqual(Object.keys(FLOOR_ART_SHA256).sort(), Object.keys(SECTOR_FLOOR_LAYOUTS).sort());
    for (const [artKey, expected] of Object.entries(FLOOR_ART_SHA256)) {
        const bytes = readFileSync(new URL(`../shinobij.client/public/sector-map/s${artKey}.webp`, import.meta.url));
        assert.equal(createHash('sha256').update(bytes).digest('hex'), expected,
            `Floor s${artKey} changed: re-check its mask, alignment and seams before admitting the new hash`);
    }
});

test('temporary rift overlays retain their reviewed asset hashes', () => {
    for (const [key, expected] of Object.entries(LANDMARK_ART_SHA256)) {
        const bytes = readFileSync(new URL(`../shinobij.client/public/landmarks/sector-${key.replace(':', '-')}.webp`, import.meta.url));
        assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `Unreviewed overlay ${key}`);
    }
});
