import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
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

    it('rejects wrong player, stale boss, and over-ceiling damage', () => {
        assert.equal(reasonOf(validateWeeklyBossFightClaim(token, { playerName: 'Other', weekKey: '2026-W27', aiId: 'ashen-dragon', bossStartedAt: 123 }, 1)), 'wrong-player-weekly-boss-token');
        assert.equal(reasonOf(validateWeeklyBossFightClaim(token, { playerName: 'Player', weekKey: '2026-W28', aiId: 'ashen-dragon', bossStartedAt: 123 }, 1)), 'stale-weekly-boss-token');
        assert.equal(reasonOf(validateWeeklyBossFightClaim(token, { playerName: 'Player', weekKey: '2026-W27', aiId: 'ashen-dragon', bossStartedAt: 123 }, 5001)), 'weekly-boss-damage-exceeds-token');
    });
});
