import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { petSummonApCost, sealedPetSummonApCost, PET_TAMER_FREE_SUMMON_RANK } from './pet-summon.js';
import { PROFESSION_MAX_RANK } from '../shinobij.client/src/constants/profession.js';

test('only a max-rank Pet Tamer receives a free summon', () => {
    assert.equal(PET_TAMER_FREE_SUMMON_RANK, PROFESSION_MAX_RANK);
    for (const profession of [undefined, 'healer', 'vanguard', 'petTamer']) {
        for (const professionRank of [undefined, NaN, Infinity, 1, 9, 10]) {
            assert.equal(petSummonApCost({ profession, professionRank }), profession === 'petTamer' && professionRank === 10 ? 0 : 20);
        }
    }
});

test('an admitted summon keeps its price; older records use the sealed owner', () => {
    const master = { profession: 'petTamer', professionRank: 10 };
    assert.equal(sealedPetSummonApCost({ summonApCost: 20 }, master), 20);
    assert.equal(sealedPetSummonApCost({ summonApCost: 0 }, { profession: 'healer', professionRank: 10 }), 0);
    assert.equal(sealedPetSummonApCost({}, master), 0);
    assert.equal(sealedPetSummonApCost({}), 20);
    assert.equal(sealedPetSummonApCost({ summonApCost: -1 }), 20);
});
