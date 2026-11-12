import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import layoutData from '../../../shared/sector-floor-layout-data.json' with { type: 'json' };
import { MOLTEN_ROCK_LIMIT, moltenShare, rockWindows } from './continuous-world-rock';

type Layout = { sector: number; artKey: number; mask: string[] };
const layouts = Object.values((layoutData as unknown as { layouts: Record<string, Layout> }).layouts);

async function crop(artKey: number, tile: number) {
    const file = fileURLToPath(new URL(`../../public/sector-map/s${artKey}.webp`, import.meta.url));
    const { width = 1024 } = await sharp(file).metadata(), size = width / 12;
    const { data } = await sharp(file).extract({ left: Math.round(tile % 12 * size), top: Math.round(Math.floor(tile / 12) * size), width: Math.round(size * 3), height: Math.round(size * 3) })
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return moltenShare(data);
}

test('rock windows rank the densest blocked ground first, in reading order on a tie', () => {
    const mask = Array.from({ length: 12 }, (_, y) => y < 3 ? '###.........' : y > 8 ? '.........###' : '............');
    assert.deepEqual(rockWindows(mask).slice(0, 2), [0, 117]);
    assert.equal(moltenShare([240, 120, 30, 255, 90, 80, 70, 255]), 0.5, 'a lava pixel next to a rock pixel');
    assert.equal(moltenShare([240, 120, 30, 0]), 0, 'transparent pixels do not count');
});

test('no floor hands the walk view a lava pool as the rock it stamps between sectors', async () => {
    const changed: number[] = [];
    for (const layout of layouts) {
        const windows = rockWindows(layout.mask).slice(0, 12);
        if (!windows.length) continue;
        let pick = windows[0]!;
        for (const tile of windows) if (await crop(layout.artKey, tile) <= MOLTEN_ROCK_LIMIT) { pick = tile; break; }
        assert.ok(await crop(layout.artKey, pick) <= MOLTEN_ROCK_LIMIT, `sector ${layout.sector}: every candidate window is molten`);
        if (pick !== windows[0]) changed.push(layout.sector);
    }
    // Only the floors whose densest window is a painted lava pool or channel move.
    assert.deepEqual(changed.sort((a, b) => a - b), [67, 70, 73]);
});
