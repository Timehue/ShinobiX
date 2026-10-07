import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { renderSectorArtEditGuide } from './sector-art-edit-guide.mjs';
import { SECTOR_FLOOR_LAYOUTS } from '../shared/sector-floor-layouts.js';

test('targeted model guide leaves the surrounding painting intact and refuses a mismatched collision footprint', async () => {
    const layout = Object.values(SECTOR_FLOOR_LAYOUTS).find(l => l.sector === 26)!;
    const tile = 81; // blocked rock beside the village, immediately adjacent to a walkable road.
    const painting = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#b8d9fa' } }).png().toBuffer();
    const result = await renderSectorArtEditGuide({ layout, painting, material: '#', tiles: [tile] });
    const { data, info } = await sharp(result).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 1024); assert.equal(info.height, 1024);
    const left = tile % 12 * 1024 / 12, top = Math.floor(tile / 12) * 1024 / 12, size = 1024 / 12;
    let unchanged = 0;
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
        if (x >= Math.floor(left) - 1 && x <= Math.ceil(left + size) + 1 && y >= Math.floor(top) - 1 && y <= Math.ceil(top + size) + 1) continue;
        const offset = (y * 1024 + x) * info.channels;
        if (data[offset] !== 184 || data[offset + 1] !== 217 || data[offset + 2] !== 250) assert.fail(`Changed untargeted painting pixel ${x},${y}`);
        unchanged++;
    }
    assert.ok(unchanged > 1_000_000);
    const center = (Math.floor(top + size / 2) * 1024 + Math.floor(left + size / 2)) * info.channels;
    assert.deepEqual([...data.subarray(center, center + 3)], [69, 73, 81]);
    await assert.rejects(renderSectorArtEditGuide({ layout, painting, material: '#', tiles: [106] }), /does not match/);
    await assert.rejects(renderSectorArtEditGuide({ layout, painting, material: '#', tiles: [-1] }), /does not match/);
    const small = await sharp(painting).resize(512, 512).toBuffer();
    await assert.rejects(renderSectorArtEditGuide({ layout, painting: small, material: '#', tiles: [81] }), /full-frame/);
});
