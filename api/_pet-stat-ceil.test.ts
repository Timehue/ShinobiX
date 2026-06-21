import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { petStatCeil, PET_BASE_STATS, PET_STAT_CEIL_FACTOR } from './_pet-stat-ceil.js';

const STATS = ['hp', 'attack', 'defense', 'speed'] as const;
// The in-game all-in level-100 growth ceiling: base * (1 + PET_LEVEL_GROWTH * 99)
// = base * (1 + 0.04 * 99) = base * 4.96 (see gainPetXp in client pet-balance).
const ALL_IN_MULT = 1 + 0.04 * 99;

describe('petStatCeil — pet-ladder anti-tamper ceiling', () => {
    it('bounds a tampered 100k stat far below the old flat clamp', () => {
        for (const rarity of Object.keys(PET_BASE_STATS)) {
            for (const stat of STATS) {
                const ceil = petStatCeil(rarity, stat);
                assert.ok(ceil < 100_000, `${rarity}.${stat} ceiling ${ceil} must be < 100000`);
                assert.equal(ceil, Math.round(PET_BASE_STATS[rarity][stat] * PET_STAT_CEIL_FACTOR));
            }
        }
    });

    it('NEVER clips a legit all-in level-100 build (base*4.96)', () => {
        for (const rarity of Object.keys(PET_BASE_STATS)) {
            for (const stat of STATS) {
                const legitMax = Math.round(PET_BASE_STATS[rarity][stat] * ALL_IN_MULT);
                assert.ok(
                    petStatCeil(rarity, stat) >= legitMax,
                    `${rarity}.${stat}: ceiling ${petStatCeil(rarity, stat)} must be >= legit max ${legitMax}`,
                );
            }
        }
    });

    it('keeps a comfortable safety margin above the legit max (≥40%)', () => {
        for (const rarity of Object.keys(PET_BASE_STATS)) {
            for (const stat of STATS) {
                const legitMax = PET_BASE_STATS[rarity][stat] * ALL_IN_MULT;
                assert.ok(
                    petStatCeil(rarity, stat) >= legitMax * 1.4,
                    `${rarity}.${stat}: ceiling should keep a ≥40% margin over the legit max`,
                );
            }
        }
    });

    it('falls back to mythic (loosest tier) for an unknown / tampered rarity', () => {
        for (const stat of STATS) {
            assert.equal(petStatCeil('not-a-rarity', stat), petStatCeil('mythic', stat));
            assert.equal(petStatCeil(undefined, stat), petStatCeil('mythic', stat));
            assert.equal(petStatCeil(123, stat), petStatCeil('mythic', stat));
        }
    });
});
