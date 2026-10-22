import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEM_CATALOG } from './_item-catalog.js';

test('Sennin God set grants its documented PvE-only damage bonus, not a copy of another set', () => {
    const ids = ['sennin-crown', 'sennin-chest', 'sennin-waist', 'sennin-legs', 'sennin-feet'];
    for (const id of ids) {
        const bonuses = ITEM_CATALOG[id]?.bonuses ?? {};
        assert.equal(bonuses.pveDamagePercent, 1.5, `${id} PvE damage bonus`);
        assert.equal(bonuses.damagePercent, undefined, `${id} must not duplicate Void Sovereign (2026-10 item-use pass)`);
        assert.equal(bonuses.reflectPercent, undefined, `${id} must not duplicate Mirror Soul`);
    }
});
