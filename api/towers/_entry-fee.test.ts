import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { BATTLE_FLOOR_FEE, debitTowerEntry, debitTowerStoryEntry, refundTowerEntry, towerEntryCost } from './_entry-fee.js';

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

    it('refunds a failed publication, including a free-entry daily reservation', () => {
        const paid = refundTowerEntry({ ryo: 3_500, dailyBattleDate: day, dailyBattleFloors: 4 }, day, BATTLE_FLOOR_FEE);
        assert.equal(paid.ryo, 5_000);
        assert.equal(paid.dailyBattleFloors, 3);

        const free = refundTowerEntry({ ryo: 100, dailyBattleDate: day, dailyBattleFloors: 1 }, day, 0);
        assert.equal(free.ryo, 100);
        assert.equal(free.dailyBattleFloors, 0);
    });

    it('does not overwrite a daily counter that already rolled to a new day', () => {
        const rolled = refundTowerEntry({ ryo: 3_500, dailyBattleDate: '2026-08-08', dailyBattleFloors: 2 }, day, BATTLE_FLOOR_FEE);
        assert.equal(rolled.ryo, 5_000);
        assert.equal(rolled.dailyBattleDate, '2026-08-08');
        assert.equal(rolled.dailyBattleFloors, 2);
    });

    it('makes an already-cleared Story floor free without advancing the entry counter', () => {
        const replay = debitTowerStoryEntry({
            ryo: 10,
            dailyBattleDate: day,
            dailyBattleFloors: 99,
            battleTowerClearedFloors: [1, 5],
        }, day, 5);
        assert.equal(replay.ok, true);
        if (!replay.ok) return;
        assert.equal(replay.charged, 0);
        assert.equal(replay.counted, false);
        assert.equal(replay.replayFree, true);
        assert.equal(replay.character.ryo, 10);
        assert.equal(replay.character.dailyBattleFloors, 99);
    });

    it('keeps an uncleared Story floor on the normal daily fee schedule', () => {
        const firstClear = debitTowerStoryEntry({
            ryo: 5_000,
            dailyBattleDate: day,
            dailyBattleFloors: 3,
            battleTowerClearedFloors: [1, 2, 3, 4],
        }, day, 5);
        assert.equal(firstClear.ok, true);
        if (!firstClear.ok) return;
        assert.equal(firstClear.charged, BATTLE_FLOOR_FEE);
        assert.equal(firstClear.counted, true);
        assert.equal(firstClear.replayFree, false);
        assert.equal(firstClear.character.dailyBattleFloors, 4);
    });
});
