import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { MAX_AI_FIGHT_RYO, MAX_AI_FIGHT_XP } from './_ai-fight-reward.js';
import {
    aiFightTokenKey,
    cleanAiFightToken,
    createAiFightTokenRecord,
    validateAiFightRewardClaim,
} from './_ai-fight-token.js';

describe('_ai-fight-token', () => {
    it('creates a bounded token record', () => {
        const token = createAiFightTokenRecord('Player', 'abc123', 12345, {
            opponentId: 'forest-ai:1',
            opponentLevel: 42.9,
        });
        assert.equal(token.playerName, 'Player');
        assert.equal(token.tokenId, 'abc123');
        assert.equal(token.mintedAt, 12345);
        assert.equal(token.maxXp, MAX_AI_FIGHT_XP);
        assert.equal(token.maxRyo, MAX_AI_FIGHT_RYO);
        assert.equal(token.opponentId, 'forest-ai:1');
        assert.equal(token.opponentLevel, 42);
    });

    it('cleans token ids for key use', () => {
        assert.equal(cleanAiFightToken(' abcDEF123 '), 'abcDEF123');
        assert.equal(cleanAiFightToken('bad-token'), '');
        assert.equal(aiFightTokenKey('Player', 'abc123'), 'ai-fight-token:Player:abc123');
    });

    it('accepts claims at or below the sealed ceiling', () => {
        const token = createAiFightTokenRecord('Player', 'abc123');
        assert.deepEqual(validateAiFightRewardClaim(token, 125.9, 90.1), { ok: true, xp: 125, ryo: 90 });
        assert.deepEqual(validateAiFightRewardClaim(token, -10, 'x'), { ok: true, xp: 0, ryo: 0 });
    });

    it('rejects claims that exceed the sealed ceiling', () => {
        const token = createAiFightTokenRecord('Player', 'abc123');
        assert.deepEqual(validateAiFightRewardClaim(token, MAX_AI_FIGHT_XP + 1, 90), {
            ok: false,
            reason: 'reward-exceeds-ai-fight-token',
        });
        assert.deepEqual(validateAiFightRewardClaim(token, 100, MAX_AI_FIGHT_RYO + 1), {
            ok: false,
            reason: 'reward-exceeds-ai-fight-token',
        });
    });
});
