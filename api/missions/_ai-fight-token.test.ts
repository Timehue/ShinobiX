import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { MAX_AI_FIGHT_RYO, MAX_AI_FIGHT_XP } from './_ai-fight-reward.js';
import {
    aiFightTokenKey,
    cleanAiFightToken,
    computeAiFightBaseReward,
    createAiFightTokenRecord,
    validateAiFightRewardClaim,
} from './_ai-fight-token.js';

describe('_ai-fight-token', () => {
    it('creates a bounded token record', () => {
        const token = createAiFightTokenRecord('Player', 'abc123', 12345, {
            opponentId: 'forest-ai:1',
            opponentLevel: 42.9,
            baseXp: 125,
            baseRyo: 90,
            battleKind: 'defense',
        });
        assert.equal(token.playerName, 'Player');
        assert.equal(token.tokenId, 'abc123');
        assert.equal(token.mintedAt, 12345);
        assert.equal(token.maxXp, MAX_AI_FIGHT_XP);
        assert.equal(token.maxRyo, MAX_AI_FIGHT_RYO);
        assert.equal(token.baseXp, 125);
        assert.equal(token.baseRyo, 90);
        assert.equal(token.rewardSource, 'server-save');
        assert.equal(token.opponentId, 'forest-ai:1');
        assert.equal(token.opponentLevel, 42);
        assert.equal(token.battleKind, 'defense');
    });

    it('normalizes unknown battle kinds to non-paying practice', () => {
        assert.equal(createAiFightTokenRecord('Player', 'abc123', 123, { battleKind: 'forged' }).battleKind, 'practice');
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

    it('uses server-sealed rewards when present instead of client-submitted amounts', () => {
        const token = createAiFightTokenRecord('Player', 'abc123', 123, { baseXp: 100, baseRyo: 75 });
        assert.deepEqual(validateAiFightRewardClaim(token, 999, 999), { ok: true, xp: 100, ryo: 75 });
    });

    it('computes AI fight base rewards from the active pet trait', () => {
        assert.deepEqual(computeAiFightBaseReward({ activePetId: 'p1', pets: [{ id: 'p1', trait: 'Swift' }] }), { xp: 125, ryo: 75, trait: 'Swift' });
        assert.deepEqual(computeAiFightBaseReward({ activePetId: 'p1', pets: [{ id: 'p1', trait: 'Lucky' }] }), { xp: 100, ryo: 90, trait: 'Lucky' });
        assert.deepEqual(computeAiFightBaseReward({ activePetId: 'p2', pets: [{ id: 'p1', trait: 'Swift' }] }), { xp: 100, ryo: 75, trait: null });
    });

    it('carries a separately discriminated solo-PvE session binding', () => {
        const token = createAiFightTokenRecord('Player', 'abc123', 1, {
            sessionRuntime: 'solo-pve',
            sessionId: 'solo-ai-deadbeef',
        });
        assert.equal(token.sessionRuntime, 'solo-pve');
        assert.equal(token.sessionId, 'solo-ai-deadbeef');
    });

    it('never stamps a solo runtime without a valid solo session id', () => {
        for (const sessionId of [undefined, '', 'bad/slash', 42]) {
            const token = createAiFightTokenRecord('Player', 'abc123', 1, { sessionRuntime: 'solo-pve', sessionId });
            assert.equal(token.sessionRuntime, undefined);
            assert.equal(token.sessionId, undefined);
        }
        const wrongRuntime = createAiFightTokenRecord('Player', 'abc123', 1, { sessionRuntime: 'tower', sessionId: 'solo-ai-1' });
        assert.equal(wrongRuntime.sessionRuntime, undefined);
        assert.equal(wrongRuntime.sessionId, undefined);
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
