import test from 'node:test';
import assert from 'node:assert/strict';
import { measureSectorSpriteDelivery, SECTOR_SPRITE_DELIVERY_LIMIT } from './sector-sprite-delivery-budget.mjs';

const files = ['assets/sector-model-pins-example.json', 'assets/sector-pose-0123456789abcdef0123.wasm.gz', 'assets/sector-pose.worker-example.js'];

test('only the three sprite bootstrap objects leave the general asset partition', () => {
    const result = measureSectorSpriteDelivery([...files, 'assets/unrelated.js', 'assets/sector-pose-unrelated.wasm'], () => 100);
    assert.deepEqual(result.files, files);
    assert.equal(result.bytes, 300);
});

test('missing or duplicate bootstrap objects cannot receive a delivery allowance', () => {
    for (let index = 0; index < files.length; index++) {
        assert.throws(() => measureSectorSpriteDelivery(files.filter((_, i) => i !== index), () => 100));
        assert.throws(() => measureSectorSpriteDelivery([...files, files[index]], () => 100));
    }
});

test('the sprite partition rejects empty, invalid and oversized delivery bytes', () => {
    for (const invalid of [0, -1, NaN, Infinity, 1.5, SECTOR_SPRITE_DELIVERY_LIMIT]) {
        assert.throws(() => measureSectorSpriteDelivery(files, () => invalid));
    }
    assert.equal(measureSectorSpriteDelivery(files, file => file === files[0] ? SECTOR_SPRITE_DELIVERY_LIMIT - 2 : 1).bytes, SECTOR_SPRITE_DELIVERY_LIMIT);
});
