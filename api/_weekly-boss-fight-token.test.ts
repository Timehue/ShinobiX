import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    cleanWeeklyBossDamageEvents,
    cleanWeeklyBossFightToken,
    validateWeeklyBossFightClaim,
    weeklyBossFightTokenKey,
    type WeeklyBossFightToken,
} from './_weekly-boss-fight-token.js';

const token: WeeklyBossFightToken = {
    playerName: 'Player',
    weekKey: '2026-W27',
    aiId: 'ashen-dragon',
    bossStartedAt: 123,
    maxDamage: 5000,
    perHitCap: 100,
    maxHits: 10,
    mintedAt: 456,
};

function reasonOf(result: ReturnType<typeof validateWeeklyBossFightClaim>): string {
    assert.equal(result.ok, false);
    return result.reason;
}

describe('_weekly-boss-fight-token', () => {
    it('cleans and keys token ids', () => {
        assert.equal(cleanWeeklyBossFightToken(' abc123 '), 'abc123');
        assert.equal(cleanWeeklyBossFightToken('bad-token'), '');
        assert.equal(weeklyBossFightTokenKey('Player', '2026-W27', 'abc123'), 'weekly-boss-fight:2026-W27:Player:abc123');
    });

    it('accepts claims inside the sealed ceiling', () => {
        assert.deepEqual(validateWeeklyBossFightClaim(token, {
            playerName: 'player',
            weekKey: '2026-W27',
            aiId: 'ashen-dragon',
            bossStartedAt: 123,
        }, 4999.9), { ok: true, damage: 4999 });
    });

    it('cleans and validates per-hit damage proof events', () => {
        assert.deepEqual(cleanWeeklyBossDamageEvents([
            { turn: 1, amount: 199.9, source: 'jutsu:fire' },
            { turn: 2, amount: 30, source: '<bad>' },
            { turn: 3, amount: 0 },
        ]), [
            { turn: 1, amount: 199, source: 'jutsu:fire' },
            { turn: 2, amount: 30 },
        ]);
        assert.deepEqual(validateWeeklyBossFightClaim(token, {
            playerName: 'player',
            weekKey: '2026-W27',
            aiId: 'ashen-dragon',
            bossStartedAt: 123,
        }, 9999, [
            { turn: 1, amount: 200, source: 'open' },
            { turn: 2, amount: 30, source: 'guarded' },
        ]), { ok: true, damage: 230 });
    });

    it('rejects wrong player, stale boss, and over-ceiling damage', () => {
        assert.equal(reasonOf(validateWeeklyBossFightClaim(token, { playerName: 'Other', weekKey: '2026-W27', aiId: 'ashen-dragon', bossStartedAt: 123 }, 1)), 'wrong-player-weekly-boss-token');
        assert.equal(reasonOf(validateWeeklyBossFightClaim(token, { playerName: 'Player', weekKey: '2026-W28', aiId: 'ashen-dragon', bossStartedAt: 123 }, 1)), 'stale-weekly-boss-token');
        assert.equal(reasonOf(validateWeeklyBossFightClaim(token, { playerName: 'Player', weekKey: '2026-W27', aiId: 'ashen-dragon', bossStartedAt: 123 }, 5001)), 'weekly-boss-damage-exceeds-token');
        assert.equal(reasonOf(validateWeeklyBossFightClaim(token, { playerName: 'Player', weekKey: '2026-W27', aiId: 'ashen-dragon', bossStartedAt: 123 }, 1, [{ turn: 2, amount: 31 }])), 'weekly-boss-proof-hit-exceeds-cap');
    });
});
