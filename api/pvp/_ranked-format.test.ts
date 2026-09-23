import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STAT_CAP_FIELDS, MAX_STAT } from '../combat-core/formulas.js';
import { applyJutsu } from './move.js';
import type { PvpFighter } from './session.js';
import {
    isRankedFormatWeaponId,
    isValidRankedFormatItemLedger,
    projectRankedFormatCharacter,
    rankedCombatLevel,
    sealRankedFormatCombatCharacter,
    RANKED_FORMAT_CONSUMABLE_CHARGES,
    RANKED_FORMAT_DEFAULT_WEAPON_ID,
    RANKED_FORMAT_LEGENDARY_WEAPON_IDS,
    RANKED_FORMAT_MAX_CHAKRA,
    RANKED_FORMAT_MAX_HP,
    RANKED_FORMAT_MAX_STAMINA,
    RANKED_FORMAT_NEUTRAL_EQUIPMENT,
    resolveRankedFormatWeaponId,
    sealRankedFormatItemCharges,
} from './_ranked-format.js';

describe('ranked format', () => {
    it('accepts only the whitelisted legendary weapons', () => {
        for (const id of RANKED_FORMAT_LEGENDARY_WEAPON_IDS) assert.equal(isRankedFormatWeaponId(id), true);
        assert.equal(isRankedFormatWeaponId('training-katana'), false);
        assert.equal(isRankedFormatWeaponId(''), false);
        assert.equal(isRankedFormatWeaponId(undefined), false);
        assert.equal(isRankedFormatWeaponId(123), false);
    });

    it('resolves an invalid or missing weapon choice to the fixed default', () => {
        assert.equal(resolveRankedFormatWeaponId(undefined), RANKED_FORMAT_DEFAULT_WEAPON_ID);
        assert.equal(resolveRankedFormatWeaponId('not-a-real-weapon'), RANKED_FORMAT_DEFAULT_WEAPON_ID);
        assert.equal(resolveRankedFormatWeaponId('frostfang-oathblade'), 'frostfang-oathblade');
    });

    it('projects maxed stats and neutral gear while keeping everything else', () => {
        const saveCharacter = {
            name: 'Ash', level: 12, specialty: 'Ninjutsu',
            equippedJutsuIds: ['a', 'b'], equippedBloodlineId: 'starter-bloodline-iron-fang',
            stats: { strength: 5, speed: 5 },
            equipment: { hand: 'training-katana', body: 'cloth-robe', thrown: 'thrown-shuriken' },
        };
        const projected = projectRankedFormatCharacter(saveCharacter, 'black-lotus-dagger');

        for (const field of STAT_CAP_FIELDS) {
            assert.equal((projected.stats as Record<string, number>)[field], MAX_STAT, `${field} is maxed`);
        }
        assert.equal(projected.hp, RANKED_FORMAT_MAX_HP);
        assert.equal(projected.maxHp, RANKED_FORMAT_MAX_HP);
        assert.equal(projected.chakra, RANKED_FORMAT_MAX_CHAKRA);
        assert.equal(projected.maxChakra, RANKED_FORMAT_MAX_CHAKRA);
        assert.equal(projected.stamina, RANKED_FORMAT_MAX_STAMINA);
        assert.equal(projected.maxStamina, RANKED_FORMAT_MAX_STAMINA);
        assert.deepEqual(projected.equipment, { ...RANKED_FORMAT_NEUTRAL_EQUIPMENT, hand: 'black-lotus-dagger' });
        // Untouched fields pass through verbatim.
        assert.equal(projected.name, 'Ash');
        assert.equal(projected.level, 12);
        assert.equal(projected.specialty, 'Ninjutsu');
        assert.deepEqual(projected.equippedJutsuIds, ['a', 'b']);
        assert.equal(projected.equippedBloodlineId, 'starter-bloodline-iron-fang');
    });

    it('maxes only the resolved ranked combat snapshot and leaves the save untouched', () => {
        const saved = {
            level: 15,
            jutsu: [{ id: 'learned' }, { id: 'legacy-signature' }],
            jutsuMastery: [{ jutsuId: 'learned', level: 2 }],
        };
        const sealed = sealRankedFormatCombatCharacter(saved);
        assert.equal(rankedCombatLevel(sealed), 100);
        assert.equal(rankedCombatLevel(saved), 15);
        assert.equal(sealed.level, 15);
        assert.deepEqual(sealed.jutsuMastery, [
            { jutsuId: 'learned', level: 50 },
            { jutsuId: 'legacy-signature', level: 50 },
        ]);
        assert.deepEqual(saved.jutsuMastery, [{ jutsuId: 'learned', level: 2 }]);
    });

    it('uses full mastery during a low-level ranked cast', () => {
        const fighter = (name: string, character: Record<string, unknown>): PvpFighter => ({
            name, hp: 100, maxHp: 1000, chakra: 1000, maxChakra: 1000,
            stamina: 1000, maxStamina: 1000, shield: 0, statuses: [], pos: 0, character,
        });
        const saved = { level: 15, specialty: 'Ninjutsu', stats: {}, jutsuMastery: [{ jutsuId: 'heal', level: 2 }], jutsu: [{ id: 'heal' }] };
        const ranked = fighter('Ash', sealRankedFormatCombatCharacter(saved));
        const ordinary = fighter('Ash', { ...saved, jutsuMastery: [{ jutsuId: 'heal', level: 50 }] });
        const opponent = fighter('Rival', { level: 15, stats: {}, jutsuMastery: [] });
        const heal = {
            id: 'heal', name: 'Heal', type: 'Ninjutsu', element: 'Water', ap: 40,
            range: 0, effectPower: 0, cooldown: 0, chakraCost: 0, staminaCost: 0,
            target: 'SELF', method: 'SINGLE', tags: [{ name: 'Heal' }],
        } as Parameters<typeof applyJutsu>[2];
        const rankedResult = applyJutsu(ranked, opponent, heal);
        const ordinaryResult = applyJutsu(ordinary, opponent, heal);
        assert.equal(rankedResult.self.hp, 850);
        assert.ok(ordinaryResult.self.hp < rankedResult.self.hp, 'ordinary PvP retains the level 15 mastery cap');
    });

    it('seals fixed, non-inventory-derived charges for the neutral kit', () => {
        const charges = sealRankedFormatItemCharges();
        assert.equal(charges[RANKED_FORMAT_NEUTRAL_EQUIPMENT.thrown], RANKED_FORMAT_CONSUMABLE_CHARGES);
        assert.equal(charges[RANKED_FORMAT_NEUTRAL_EQUIPMENT.item1], RANKED_FORMAT_CONSUMABLE_CHARGES);
        assert.equal(charges[RANKED_FORMAT_NEUTRAL_EQUIPMENT.item2], RANKED_FORMAT_CONSUMABLE_CHARGES);
        assert.equal(charges[RANKED_FORMAT_NEUTRAL_EQUIPMENT.item3], RANKED_FORMAT_CONSUMABLE_CHARGES);
        assert.equal(charges[RANKED_FORMAT_NEUTRAL_EQUIPMENT.potion], RANKED_FORMAT_CONSUMABLE_CHARGES);
        // Never keyed by the hand slot (the player's own weapon is reusable,
        // not a consumable charge) or by anything ownership-derived.
        assert.equal(Object.keys(charges).length, 5);
    });

    it('accepts only a complete, conserved neutral item ledger', () => {
        const charges = sealRankedFormatItemCharges();
        const thrown = RANKED_FORMAT_NEUTRAL_EQUIPMENT.thrown;
        charges[thrown] -= 1;
        assert.equal(isValidRankedFormatItemLedger(charges, { [thrown]: 1 }), true);
        assert.equal(isValidRankedFormatItemLedger(charges, { [thrown]: 2 }), false, 'remaining + used must equal the grant');
        assert.equal(isValidRankedFormatItemLedger(charges, { forged: 1 }), false, 'foreign item ids fail closed');
        const missing = { ...charges };
        delete missing[RANKED_FORMAT_NEUTRAL_EQUIPMENT.potion];
        assert.equal(isValidRankedFormatItemLedger(missing, { [thrown]: 1 }), false, 'every neutral item remains represented');
    });
});
