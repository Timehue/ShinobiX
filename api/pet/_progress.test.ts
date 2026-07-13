import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gainServerPetXp, removePetItem, settleServerPetExpedition } from './_progress.js';

describe('server pet progression', () => {
    it('levels from bounded XP and channels growth into the chosen stat', () => {
        const pet = { rarity: 'standard', level: 1, maxLevel: 100, xp: 0, hp: 320, attack: 40, defense: 28, speed: 30, jutsus: [{ power: 50 }] };
        const out = gainServerPetXp(pet, 100, 'strength');
        assert.equal(out.level, 2); assert.equal(out.attack, 42); assert.equal(out.hp, 320);
    });
    it('consumes one counted or legacy inventory treat', () => {
        assert.deepEqual(removePetItem({ itemStacks: [{ itemId: 'pet-treat', count: 2 }] }, 'pet-treat')?.itemStacks, [{ itemId: 'pet-treat', count: 1 }]);
        assert.deepEqual(removePetItem({ inventory: ['pet-treat', 'x'] }, 'pet-treat')?.inventory, ['x']);
    });
    it('settles expedition combat growth and clears the server session', () => {
        const pet = { rarity: 'standard', level: 1, maxLevel: 100, xp: 0, hp: 320, attack: 40, defense: 28, speed: 30, jutsus: [], expedition: { type: 'scout' } };
        const out = settleServerPetExpedition(pet, 'scout', 45, 1);
        assert.equal(out.pet.expedition, undefined); assert.equal(out.statGain, 1); assert.ok(Number(out.pet.attack) > 40);
    });
});
