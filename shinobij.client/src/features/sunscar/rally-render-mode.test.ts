import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rallyUsesEconomy } from './rally-render-mode';
import { rallyEconomyFinishSlot, rallyEconomyProjection } from './rally-economy-projection';
import { RALLY_ECONOMY_CONTACT_ANCHOR } from './rally-economy-pose';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { rawPetPool } from '../../data/pet-pool';
import { STARTER_PETS } from '../../data/starter-pets';
import { STARTER_EVOLUTIONS, petVisualId } from '../../data/pet-evolutions';
import { RALLY_TRACKS } from '../../../../shared/sunscar/rally-tracks';

test('economy starts before model loading on constrained hardware, with explicit user choice', () => {
    assert.equal(rallyUsesEconomy('auto', 4, 8), true);
    assert.equal(rallyUsesEconomy('auto', 8, 2), true);
    assert.equal(rallyUsesEconomy('auto', 8, 8), false);
    assert.equal(rallyUsesEconomy('auto'), false);
    assert.equal(rallyUsesEconomy('3d', 2, 2), false);
    assert.equal(rallyUsesEconomy('economy', 16, 16), true);
});
test('economy finish slots stay distinct and inside a narrow viewport', () => {
    const track = RALLY_TRACKS[0];
    const points = Array.from({ length: 4 }, (_, place) => {
        const slot = rallyEconomyFinishSlot(place);
        return rallyEconomyProjection(track, track.length, track.length + slot.distance, slot.lane, 320, 600);
    });
    assert.equal(new Set(points.map(point => point.x)).size, 4);
    for (const point of points) assert.ok(point.x > 45 && point.x < 275);
});
test('economy publishes planted transparent six-pose atlases for every canonical pet within its download budget', async () => {
    const pets = [...rawPetPool, ...STARTER_PETS.map(option => option.pet), ...STARTER_EVOLUTIONS];
    const visualIds = new Set(pets.map(petVisualId));
    assert.equal(visualIds.size, 161);
    for (const id of [
        ...Array.from({ length: 6 }, (_, index) => `mythic-${index + 10}`),
        'starter-fire-r', 'starter-water-l', 'starter-lightning-r', 'starter-earth',
    ]) assert.ok(visualIds.has(id), `${id} is covered by the canonical roster`);

    let totalBytes = 0;
    const cellSize = 192;
    const contactRow = cellSize * RALLY_ECONOMY_CONTACT_ANCHOR;
    // Pixel centers within three source pixels tolerate raster antialiasing,
    // while rejecting the previous visibly floating 8–38 pixel pose gaps.
    const contactFirstRow = Math.ceil(contactRow - 3 - .5);
    const contactLastRow = Math.floor(contactRow + 3 - .5);
    // Cells 0–3 run away down the road; 4 is rear ready and 5 is front ready.
    for (const id of visualIds) {
        const path = new URL(`../../../public/pet-rally/${id}.webp`, import.meta.url);
        assert.ok(existsSync(path), `${id} atlas exists`);
        const encoded = await readFile(path);
        assert.ok(encoded.length <= 80 * 1024, `${id} atlas is at most 80 KiB (${encoded.length} bytes)`);
        totalBytes += encoded.length;
        const metadata = await sharp(encoded).metadata();
        assert.equal(metadata.width, cellSize * 6, `${id} has six horizontal cells`);
        assert.equal(metadata.height, cellSize, `${id} cells are square and 192 pixels high`);
        assert.equal(metadata.hasAlpha, true, `${id} preserves transparency`);

        const { data, info } = await sharp(encoded).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        assert.equal(info.channels, 4);
        for (let cell = 0; cell < 6; cell++) {
            let transparent = false, visible = false;
            for (let y = 0; y < cellSize && !(transparent && visible); y++) {
                for (let x = cell * cellSize; x < (cell + 1) * cellSize && !(transparent && visible); x++) {
                    const alpha = data[(y * info.width + x) * info.channels + 3];
                    transparent ||= alpha === 0;
                    visible ||= alpha > 0;
                }
            }
            assert.ok(transparent, `${id} cell ${cell} has a transparent background`);
            assert.ok(visible, `${id} cell ${cell} contains artwork`);
            let contactPixels = 0;
            for (let y = contactFirstRow; y <= contactLastRow && contactPixels < 2; y++) {
                for (let x = cell * cellSize; x < (cell + 1) * cellSize && contactPixels < 2; x++) {
                    if (data[(y * info.width + x) * info.channels + 3] >= 16) contactPixels++;
                }
            }
            assert.ok(contactPixels >= 2, `${id} cell ${cell} must visibly touch the shared ground anchor at row ${contactRow}`);
        }
    }
    assert.ok(totalBytes <= 6 * 1024 * 1024, `all 161 atlases total at most 6 MiB (${totalBytes} bytes)`);
});
test('economy projection preserves lane order, warning distance and approaching hazard growth', () => {
    for (const track of RALLY_TRACKS) for (const width of [320, 390, 1440]) {
        const project = (distance: number, lane = 0) => rallyEconomyProjection(track, 200, distance, lane, width, 600);
        assert.ok(project(200, -1).x < project(200).x && project(200).x < project(200, 1).x);
        assert.ok(project(220).scale > project(280).scale);
        assert.ok(project(220).y > project(280).y);
        assert.equal(project(325).visible, true);
        assert.equal(project(326).visible, false);
        assert.equal(project(187).visible, false);
    }
});
