import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STAT_CAP_FIELDS, MAX_STAT } from '../combat-core/formulas.js';
import {
    isRankedFormatWeaponId,
    isValidRankedFormatItemLedger,
    projectRankedFormatCharacter,
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
