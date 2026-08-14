import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEM_CATALOG } from './_item-catalog.js';

test('Sennin God set grants its documented damage bonus, not duplicate reflect', () => {
    const ids = ['sennin-crown', 'sennin-chest', 'sennin-waist', 'sennin-legs', 'sennin-feet'];
    for (const id of ids) {
        const bonuses = ITEM_CATALOG[id]?.bonuses ?? {};
        assert.equal(bonuses.damagePercent, 1, `${id} damage bonus`);
        assert.equal(bonuses.reflectPercent, undefined, `${id} must not duplicate Mirror Soul`);
    }
});
