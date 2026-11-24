import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import sharp from 'sharp';

const dir = fileURLToPath(new URL('../public/coast-map/', import.meta.url));
test('all five trail paintings tile end to end and feather into the regional ground', async () => {
    for (let region = 1; region <= 5; region++) {
        const { data, info } = await sharp(dir + 'trail-straight-' + region + '.webp').raw().toBuffer({ resolveWithObject: true });
        assert.equal(info.channels, 4);
        assert.equal(info.height, 128);
        const pixel = (x, y) => data.subarray((y * info.width + x) * 4, (y * info.width + x + 1) * 4);
        for (const x of [0, Math.floor(info.width / 2), info.width - 1]) {
            assert.ok(pixel(x, 0)[3] < 10 && pixel(x, 127)[3] < 10, 'both shoulders fade out');
            assert.equal(pixel(x, 64)[3], 255);
        }
        for (let y = 36; y <= 92; y += 4) {
            const left = pixel(0, y), right = pixel(info.width - 1, y);
            assert.ok(left.every((c, i) => Math.abs(c - right[i]) < 25), 'the repeated ends meet');
        }
        const corner = await sharp(dir + 'trail-corner-' + region + '.webp').raw().toBuffer({ resolveWithObject: true });
        assert.deepEqual([corner.info.width, corner.info.height, corner.info.channels], [240, 240, 4]);
        assert.equal(corner.data[3], 0, 'no rectangular corner stamp');
        assert.equal(corner.data[(120 * 240 + 120) * 4 + 3], 255);
        const ground = await sharp(dir + 'trail-ground-' + region + '.webp').metadata();
        assert.equal(ground.width, ground.height);
        const relief = await sharp(dir + 'trail-relief-' + region + '.webp').metadata();
        assert.deepEqual([relief.width, relief.height, relief.hasAlpha], [240, 240, true]);
    }
    assert.equal((await sharp(dir + 'trail-bridge.webp').metadata()).hasAlpha, true);
});
