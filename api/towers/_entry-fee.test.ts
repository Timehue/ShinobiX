import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { BATTLE_FLOOR_FEE, debitTowerEntry, towerEntryCost } from './_entry-fee.js';

describe('server-authoritative Battle Tower entry fee', () => {
    const day = '2026-08-07';

    it('allows three free entries, then charges the stored wallet', () => {
        assert.equal(towerEntryCost({ ryo: 5_000, dailyBattleDate: day, dailyBattleFloors: 2 }, day), 0);
        const fourth = debitTowerEntry({ ryo: 5_000, dailyBattleDate: day, dailyBattleFloors: 3 }, day);
        assert.equal(fourth.ok, true);
        if (fourth.ok) {
            assert.equal(fourth.charged, BATTLE_FLOOR_FEE);
            assert.equal(fourth.character.ryo, 3_500);
            assert.equal(fourth.character.dailyBattleFloors, 4);
        }
    });

    it('resets on a new UTC day and rejects an unaffordable paid entry', () => {
        const reset = debitTowerEntry({ ryo: 0, dailyBattleDate: '2026-08-06', dailyBattleFloors: 99 }, day);
        assert.equal(reset.ok, true);
        const denied = debitTowerEntry({ ryo: 1_499, dailyBattleDate: day, dailyBattleFloors: 3 }, day);
        assert.deepEqual(denied, { ok: false, required: BATTLE_FLOOR_FEE });
    });
});
