import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import type { ShowdownSession } from '../_pet-showdown/engine.js';
import { grantShowdownParticipationXp, SHOWDOWN_PARTICIPATION_XP } from './_showdown-xp.js';
import { SHOWDOWN_DAILY_WIN_CAP } from '../../shared/pet-showdown-contract.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
after(() => { delete process.env.SHINOBIX_QA_MEMORY_KV; });

const pet = (id: string, level = 1, xp = 0) => ({
    id, name: id, level, xp, maxLevel: 100, rarity: 'standard',
    hp: 400, attack: 50, defense: 30, speed: 35,
    growthBaseStats: { hp: 400, attack: 50, defense: 30, speed: 35 },
    growthAllocation: { vitality: 0, power: 0, guard: 0, agility: 0 },
    jutsus: [{ name: 'Ember Jab', kind: 'damage', power: 90 }],
});
const session = (ids = ['lead', 'reserve'], participationIds = ['lead']): ShowdownSession => ({
    sessionId: 'xp-fixture', playerName: 'xpprobe', rulesetVersion: 'progression-v3',
    participationIds, player: ids.map(id => ({ id })),
    format: '1v1', finished: true, outcome: 'win', rewardEligible: true, sealedOpponentLevel: 1,
} as unknown as ShowdownSession);

describe('Colosseum participation XP', () => {
    it('preserves bounded stable ability IDs through command admission', async () => {
        const { parseCommands } = await import('./showdown.js');
        assert.deepEqual(parseCommands([
            { kind: 'move', petId: 'lead', moveIndex: 1, targetId: 'foe', abilityId: 'species:art:advanced', unlockLevel: 1 },
            { kind: 'super', petId: 'lead', targetId: 'foe', abilityId: 'species:finisher:signature' },
            { kind: 'move', petId: 'lead', moveIndex: 0, targetId: 'foe', abilityId: { forged: true } },
        ], 3), [
            { kind: 'move', petId: 'lead', moveIndex: 1, targetId: 'foe', abilityId: 'species:art:advanced' },
            { kind: 'super', petId: 'lead', targetId: 'foe', abilityId: 'species:finisher:signature' },
            { kind: 'move', petId: 'lead', moveIndex: 0, targetId: 'foe' },
        ]);
    });

    it('shares exactly one bounded budget across proven participants, with no last-hit requirement', () => {
        const original = { pets: [pet('lead'), pet('reserve'), pet('unused')] };
        const result = grantShowdownParticipationXp(original, session(['lead', 'reserve', 'unused'], ['reserve', 'lead', 'forged', 'lead']));
        assert.equal(result.total, SHOWDOWN_PARTICIPATION_XP);
        assert.deepEqual(result.awards.map(award => [award.petId, award.xp]), [['lead', 10], ['reserve', 10]]);
        assert.equal((result.character.pets as ReturnType<typeof pet>[])[2].xp, 0);
        assert.equal(original.pets[0].xp, 0, 'the pure grant never mutates its input');
    });

    it('distributes a remainder deterministically and excludes max-level pets before splitting', () => {
        const original = { pets: [pet('a'), pet('b'), pet('c'), pet('max', 100)] };
        const result = grantShowdownParticipationXp(original, session(['a', 'b', 'c', 'max'], ['max', 'c', 'b', 'a']));
        assert.deepEqual(result.awards.map(award => award.xp), [7, 7, 6]);
        assert.equal(result.total, 20);
        assert.equal((result.character.pets as ReturnType<typeof pet>[])[3], original.pets[3]);
    });

    it('uses canonical XP/level growth and preserves ownership, allocations, equipment and evolution', () => {
        const source = { ...pet('lead', 1, 90), evolutionStage: 2, nickname: 'Ember',
            origin: 'bred', loadout: { pvp: 'kept-gear' }, rankedBuild: { moveIds: ['kept-choice'] } };
        const result = grantShowdownParticipationXp({ pets: [source] }, session(['lead']));
        const next = (result.character.pets as Record<string, unknown>[])[0];
        assert.equal(next.level, 2);
        assert.equal(next.xp, 10);
        assert.equal(next.growthPoints, 3);
        for (const field of ['id', 'nickname', 'origin', 'evolutionStage', 'loadout', 'rankedBuild', 'growthAllocation']) {
            assert.deepEqual(next[field], source[field as keyof typeof source]);
        }
        assert.deepEqual(result.awards, [{ petId: 'lead', xp: 20, levelBefore: 1, levelAfter: 2 }]);
    });

    it('never pays practice, losses, unfinished sessions, unproven reserves or retained old sessions', () => {
        const original = { pets: [pet('lead'), pet('reserve')] };
        const base = session();
        for (const variant of [
            { ...base, rewardEligible: false }, { ...base, outcome: 'loss' as const },
            { ...base, finished: false }, { ...base, participationIds: [] },
            { ...base, participationIds: ['forged'] }, { ...base, rulesetVersion: undefined },
        ]) {
            const result = grantShowdownParticipationXp(original, variant);
            assert.equal(result.character, original);
            assert.equal(result.total, 0);
        }
    });

    it('commits XP with the paying receipt exactly once across concurrent terminal retries', async () => {
        const [{ kv }, { settleShowdownWin }] = await Promise.all([import('../_storage.js'), import('./showdown.js')]);
        const playerName = 'showdownxponce';
        const battle = { ...session(['lead', 'reserve'], ['lead', 'reserve']), playerName, sessionId: 'ShowdownXpReceipt01' };
        await kv.set(`save:${playerName}`, { _saveVersion: 1, character: {
            name: playerName, level: 30, ryo: 10, totalPetWins: 0, dailyPetWins: 0,
            lastDailyReset: new Date().toISOString().slice(0, 10), tileCards: [],
            pets: [pet('lead'), pet('reserve')],
        } });
        const results = await Promise.all([settleShowdownWin(playerName, battle), settleShowdownWin(playerName, battle)]);
        assert.equal(results.reduce((sum, result) => sum + Number(result.petXpTotal ?? 0), 0), 20);
        assert.equal(results.filter(result => Number(result.reward) > 0).length, 1);
        const stored = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const character = stored!.character as Record<string, unknown>;
        assert.deepEqual((character.pets as Record<string, unknown>[]).map(p => p.xp), [10, 10]);
        assert.deepEqual(character.redeemedPetBattleTokens, ['sd:ShowdownXpReceipt01']);
        assert.equal(character.dailyPetWins, 1);
        const replay = await settleShowdownWin(playerName, battle);
        assert.equal(replay.reward, 0);
        assert.equal(replay.petXpTotal ?? 0, 0);
        assert.deepEqual(await kv.get(`save:${playerName}`), stored);
    });

    it('keeps XP and rewards unchanged at the daily win cap', async t => {
        t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
        const [{ kv }, { settleShowdownWin }] = await Promise.all([import('../_storage.js'), import('./showdown.js')]);
        const playerName = 'showdownxpcapped';
        const original = { _saveVersion: 1, character: { name: playerName, level: 30, ryo: 10,
            dailyPetWins: SHOWDOWN_DAILY_WIN_CAP, lastDailyReset: new Date().toISOString().slice(0, 10), pets: [pet('lead')] } };
        await kv.set(`save:${playerName}`, original);
        const result = await settleShowdownWin(playerName, { ...session(['lead']), playerName, sessionId: 'ShowdownXpCapped' });
        assert.equal(result.capped, true);
        assert.equal(result.petXpTotal ?? 0, 0);
        assert.deepEqual(await kv.get(`save:${playerName}`), original);
    });
});
