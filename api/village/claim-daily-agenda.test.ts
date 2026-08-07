import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAgendaPersonalReward, applyAgendaTreasuryReward } from './claim-daily-agenda.js';

test('daily agenda personal reward and receipt share an idempotent save mutation', () => {
    const first = applyAgendaPersonalReward({ profession: 'vanguard', ryo: 10, boneCharms: 2, honorSeals: 3, villageMerit: 4 }, '2026-08-07');
    assert.equal(first.alreadyClaimed, false);
    assert.deepEqual(first.granted, { ryo: 750, boneCharms: 1, honorSeals: 8 });
    assert.equal(first.character.claimedVillageAgendaDate, '2026-08-07');
    const replay = applyAgendaPersonalReward(first.character, '2026-08-07');
    assert.equal(replay.alreadyClaimed, true);
    assert.deepEqual(replay.granted, { ryo: 0, boneCharms: 0, honorSeals: 0 });
    assert.equal(replay.character.ryo, 760);
});

test('daily agenda treasury receipt prevents a duplicate credit', () => {
    const first = applyAgendaTreasuryReward({ treasury: { ryo: 100 } }, '2026-08-07:player');
    assert.equal(first.alreadyClaimed, false);
    assert.equal(first.treasury.ryo, 1600);
    const replay = applyAgendaTreasuryReward(first.state, '2026-08-07:player');
    assert.equal(replay.alreadyClaimed, true);
    assert.equal(replay.treasury.ryo, 1600);
});

test('daily agenda drops old-day receipts but retains every current-day claimant', () => {
    const old = Array.from({ length: 500 }, (_, index) => `2026-08-06:old-${index}`);
    const today = Array.from({ length: 500 }, (_, index) => `2026-08-07:today-${index}`);
    const applied = applyAgendaTreasuryReward({ agendaClaimReceipts: [...old, ...today], treasury: {} }, '2026-08-07:new-player');
    const receipts = applied.state.agendaClaimReceipts as string[];
    assert.equal(receipts.length, 501);
    assert.ok(receipts.includes('2026-08-07:today-0'));
    assert.ok(receipts.every((receipt) => receipt.startsWith('2026-08-07:')));
});
