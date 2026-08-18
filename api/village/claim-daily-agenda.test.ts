import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

describe('Vanguard village tithe — PvP work funds the village', () => {
    const state = () => ({ treasury: { honorSeals: 0 }, agendaClaimReceipts: [] as string[] });

    it('a Vanguard claim pays the treasury more than anyone else', () => {
        const vanguard = applyAgendaTreasuryReward(state(), '2026-08-17:kaito', true);
        const other = applyAgendaTreasuryReward(state(), '2026-08-17:mei', false);
        assert.equal(Number(vanguard.treasury.honorSeals), 50);
        assert.equal(Number(other.treasury.honorSeals), 15);
        assert.ok(
            Number(vanguard.treasury.honorSeals) > Number(other.treasury.honorSeals),
            'the Vanguard is the village economic engine — village upgrades are funded from this pool',
        );
    });

    it('defaults to the base credit when the flag is absent', () => {
        // Old callers / replays must never accidentally mint the tithe.
        assert.equal(Number(applyAgendaTreasuryReward(state(), '2026-08-17:mei').treasury.honorSeals), 15);
    });

    it('stays one credit per player per UTC day, tithe or not', () => {
        const first = applyAgendaTreasuryReward(state(), '2026-08-17:kaito', true);
        assert.equal(first.alreadyClaimed, false);
        const replay = applyAgendaTreasuryReward(first.state, '2026-08-17:kaito', true);
        assert.equal(replay.alreadyClaimed, true);
        assert.equal(Number(replay.treasury.honorSeals), 50, 'a replay must not double-credit the tithe');
    });

    it('the handler reads the profession from the LOCKED save, never the request', () => {
        const src = readFileSync(join(process.cwd(), 'api', 'village', 'claim-daily-agenda.ts'), 'utf8');
        assert.match(src, /isVanguard: char\.profession === 'vanguard'/);
        assert.match(src, /applyAgendaTreasuryReward\(state, claimId, isVanguardClaimer\)/);
        assert.doesNotMatch(src, /body\.profession|body\?\.profession/);
    });
});
