import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { versionedPlayerRecord } from '../save/_mutate-player-save.js';
import { applyAiFightSecondaryRewards } from './_ai-fight-secondary.js';
import { createAiFightTokenRecord } from './_ai-fight-token.js';

const base = {
    profession: 'vanguard', masterySpec: {}, inventory: ['old'], stamina: 90, maxStamina: 100,
    honorSeals: 1, auraDust: 2, boneCharms: 3, fateShards: 4,
    totalAiKills: 5, dailyAiKills: 6, totalVillageRaids: 7,
    defeatedAiIds: [], aiKills: {},
};

describe('_ai-fight-secondary', () => {
    it('atomically grants the sealed defense reward and counters', () => {
        const token = createAiFightTokenRecord('P', 't', 1, { battleKind: 'defense', opponentId: 'enemy' });
        const next = applyAiFightSecondaryRewards(base, token, true);
        assert.deepEqual(next.inventory, ['old'], 'ordinary AI wins do not drop Territory Scrolls');
        assert.equal(next.stamina, 100);
        assert.equal(next.honorSeals, 21);
        assert.equal(next.auraDust, 10);
        assert.equal(next.boneCharms, 5);
        assert.equal(next.fateShards, 4);
        assert.equal(next.totalAiKills, 6);
        assert.equal(next.dailyAiKills, 7);
        assert.deepEqual(next.defeatedAiIds, ['enemy']);
        assert.deepEqual(next.aiKills, { enemy: 1 });
    });

    it('grants raid counters and profession-neutral charm substitute', () => {
        const token = createAiFightTokenRecord('P', 't', 1, { battleKind: 'raidAi', opponentId: 'enemy' });
        const next = applyAiFightSecondaryRewards({ ...base, profession: 'healer' }, token, true);
        assert.equal(next.honorSeals, 1);
        assert.equal(next.auraDust, 6);
        assert.equal(next.boneCharms, 4);
        assert.equal(next.totalVillageRaids, 8);
    });

    it('pays nothing for practice or after the hard ceiling', () => {
        const practice = createAiFightTokenRecord('P', 't', 1, { battleKind: 'practice' });
        const mission = createAiFightTokenRecord('P', 't', 1, { battleKind: 'mission' });
        assert.equal(applyAiFightSecondaryRewards(base, practice, true), base);
        assert.equal(applyAiFightSecondaryRewards(base, mission, false), base);
    });

    it('pays ordinary World encounter rewards without impersonating a village raid', () => {
        const token = createAiFightTokenRecord('P', 't', 1, { battleKind: 'world', opponentId: 'world-foe' });
        const next = applyAiFightSecondaryRewards(base, token, true);
        assert.deepEqual(next.inventory, ['old'], 'world encounters do not drop Territory Scrolls');
        assert.equal(next.stamina, 100);
        assert.equal(next.totalAiKills, 6);
        assert.equal(next.dailyAiKills, 7);
        assert.equal(next.totalVillageRaids, 7);
        assert.equal(next.honorSeals, 1);
        assert.equal(next.auraDust, 2);
        assert.equal(next.boneCharms, 3);
        assert.deepEqual(next.aiKills, { 'world-foe': 1 });
    });

    it('only grants the Ironclad roll to a valid capstone owner', () => {
        const token = createAiFightTokenRecord('P', 't', 1, { battleKind: 'mission' });
        const next = applyAiFightSecondaryRewards({ ...base, masterySpec: { ironclad: 1 } }, token, true, true);
        assert.equal(next.boneCharms, 4);
    });
});


it('only eligible PvE victories credit the council win ledger in the authoritative save', () => {
    const character = { ...base, village: 'Frostfang Village' };
    for (const [battleKind, eligible, expected] of [['world', true, 1], ['raidAi', true, 1], ['dungeon', true, 1], ['practice', true, 0], ['mission', false, 0]] as const) {
        const token = createAiFightTokenRecord('P', 't', 1, { battleKind });
        const awarded = applyAiFightSecondaryRewards(character, token, eligible);
        const saved = versionedPlayerRecord({ character }, awarded).record.character as Record<string, any>;
        assert.equal(saved.elderWinDays?.[0]?.pve ?? 0, expected, battleKind);
    }
});
