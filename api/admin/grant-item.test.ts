import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyAdminItemGrant } from './grant-item.js';

describe('admin item grant settlement', () => {
    it('grants once and replays without duplicating the item', () => {
        const first = applyAdminItemGrant({ inventory: ['old'] }, 'shinobi-vest', 'grant-item-12345678', 100);
        assert.equal(first.ok, true);
        if (!first.ok) return;
        assert.deepEqual(first.character.inventory, ['old', 'shinobi-vest']);

        const replay = applyAdminItemGrant(first.character, 'shinobi-vest', 'grant-item-12345678', 200);
        assert.equal(replay.ok, true);
        if (!replay.ok) return;
        assert.equal(replay.replayed, true);
        assert.deepEqual(replay.character.inventory, ['old', 'shinobi-vest']);
    });

    it('rejects reuse of a request id for a different item', () => {
        const first = applyAdminItemGrant({}, 'shinobi-vest', 'grant-item-12345678');
        assert.equal(first.ok, true);
        if (!first.ok) return;
        const conflict = applyAdminItemGrant(first.character, 'rustfang-kunai', 'grant-item-12345678');
        assert.deepEqual(conflict, { ok: false, error: 'receipt-conflict' });
    });
});
