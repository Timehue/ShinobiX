import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gainServerPetXp, removePetItem, settleServerPetExpedition, settleFinishedTraining } from './_progress.js';
import { mergePreservingImages } from '../_utils.js';

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
    it('settleFinishedTraining leaves a still-running session untouched', () => {
        const training = { type: 'strength', endsAt: 10_000, sealedXp: 100 };
        const pet = { rarity: 'standard', level: 1, maxLevel: 100, xp: 0, hp: 320, attack: 40, defense: 28, speed: 30, jutsus: [], training };
        const out = settleFinishedTraining(pet, 5_000); // now < endsAt
        assert.equal(out.settledFocus, null);
        assert.equal(out.pet, pet);          // returned unchanged (same reference)
        assert.deepEqual(out.pet.training, training);
    });
    it('settleFinishedTraining pays out and clears a finished session', () => {
        const pet = { rarity: 'standard', level: 1, maxLevel: 100, xp: 0, hp: 320, attack: 40, defense: 28, speed: 30, jutsus: [{ power: 50 }], training: { type: 'strength', endsAt: 10_000, sealedXp: 100 } };
        const out = settleFinishedTraining(pet, 20_000); // now >= endsAt
        assert.equal(out.settledFocus, 'strength');
        assert.equal(out.pet.training, undefined);       // cleared
        // Cleared as an explicit `undefined` VALUE (key present), NOT `delete`d —
        // a deleted key is resurrected by the image-preserving save merge (below).
        assert.ok('training' in out.pet);
        assert.equal(out.pet.level, 2);                  // 100 XP = one level-up at level 1
        assert.equal(out.pet.attack, 42);                // strength channels the growth into attack
    });
    it('a cleared training survives the image-preserving save merge (regression: delete resurrects it)', () => {
        // Reproduces the versioned-save write: mergePreservingImages(mutatedPet, storedPet).
        // The merge starts from the STORED pet and only overrides keys the mutated
        // payload actually contains — so a `delete`d training would come back and the
        // claim would silently revert. An explicit `undefined` key overrides it.
        const stored = { id: 'p1', rarity: 'standard', level: 1, maxLevel: 100, xp: 0, hp: 320, attack: 40, defense: 28, speed: 30, jutsus: [{ power: 50 }], training: { type: 'strength', endsAt: 10_000, sealedXp: 100 } };
        const { pet: cleared } = settleFinishedTraining(stored, 20_000);
        const merged = mergePreservingImages(cleared, stored) as Record<string, unknown>;
        assert.equal(merged.training, undefined); // NOT resurrected from `stored`
        assert.equal(merged.level, 2);            // the settle's XP/level-up still lands
    });
    it('settleFinishedTraining nudges happiness on a finished bond session', () => {
        const pet = { rarity: 'standard', level: 1, maxLevel: 100, xp: 0, happiness: 50, hp: 320, attack: 40, defense: 28, speed: 30, jutsus: [], training: { type: 'bond', endsAt: 0, sealedXp: 60 } };
        const out = settleFinishedTraining(pet, 1);
        assert.equal(out.settledFocus, 'bond');
        assert.equal(out.pet.happiness, 55);
    });
    it('start-training self-heals a finished session instead of trapping the pet', () => {
        const progress = readFileSync(join(process.cwd(), 'api', 'pet', 'progress.ts'), 'utf8');
        const helper = readFileSync(join(process.cwd(), 'api', 'pet', '_progress.ts'), 'utf8');
        // Both the explicit collect AND the start-time self-heal settle via the one shared helper.
        assert.match(progress, /settleFinishedTraining/);
        // A still-running (not-yet-finished) session still blocks a fresh start.
        assert.match(progress, /Collect the previous training before starting another/);
        // The settle clears training via an explicit `undefined` (survives the save
        // merge) rather than `delete` (which the merge resurrects). Guard against a
        // regression back to delete.
        assert.match(helper, /training: undefined/);
        assert.doesNotMatch(helper, /delete idle\.training/);
    });
});
