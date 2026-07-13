import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
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
        assert.deepEqual(next.inventory, ['old', 'territory-control-scroll']);
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

    it('only grants the Ironclad roll to a valid capstone owner', () => {
        const token = createAiFightTokenRecord('P', 't', 1, { battleKind: 'mission' });
        const next = applyAiFightSecondaryRewards({ ...base, masterySpec: { ironclad: 1 } }, token, true, true);
        assert.equal(next.boneCharms, 4);
    });
});
