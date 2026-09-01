import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWarfrontAiTeam } from './_warfront-ai.js';
import { RITE_BAND_SIZE, isValidRiteBand, riteBandElements } from '../_pet-sim/pet-warfront-rite.js';

/*
 * ⚠ ASYMMETRIC ON PURPOSE. The PLAYER has no element requirement — that gate was
 * removed by owner ruling 2026-09-01 (see pet-warfront-rite.ts): a player may
 * field any band they own and take the matchup knowingly.
 *
 * The GENERATED RIVAL is held to a diversity floor anyway, because it is not a
 * choice anyone made. Measured on the real pool: a mono-element band wins ~1.2%
 * against its hard counter at equal level, two of five matchups a flat 0.0%. A
 * player choosing that is a decision; being handed it by the opponent generator
 * is a coin flip decided before they touch anything. The current pool cycles
 * Wind/Earth/Fire, landing three distinct elements across four slots; this test
 * exists so a future pool edit cannot quietly drop below that.
 */
/** Diversity floor for the GENERATED band only — deliberately not exported from
 *  the engine, so it can never be mistaken for a rule the player must satisfy. */
const AI_MIN_ELEMENTS = 3;

test('the generated Warfront rival band is always legal for the Rite', () => {
    const band = buildWarfrontAiTeam(RITE_BAND_SIZE);
    assert.equal(band.length, RITE_BAND_SIZE, 'the rival band must fill every slot');
    assert.ok(
        riteBandElements(band).length >= AI_MIN_ELEMENTS,
        `the rival band carries only ${riteBandElements(band).join('/')} — a mono-element band is a coin flip, not a match`,
    );
    assert.ok(isValidRiteBand(band), 'the rival band must pass the same validator the player’s band does');
});

test('every rival band size the builder accepts stays element-diverse at full size', () => {
    for (let size = 1; size <= RITE_BAND_SIZE; size++) {
        const band = buildWarfrontAiTeam(size);
        assert.equal(band.length, size);
        if (size >= AI_MIN_ELEMENTS) {
            assert.ok(
                riteBandElements(band).length >= AI_MIN_ELEMENTS,
                `a ${size}-pet rival band collapsed to ${riteBandElements(band).length} element(s)`,
            );
        }
    }
});

test('rival pets carry the element the pool declares, so the matchup shown is the matchup fought', () => {
    const band = buildWarfrontAiTeam(RITE_BAND_SIZE);
    for (const pet of band) {
        assert.ok(pet.element, `${pet.id} reached the Rite without an element`);
    }
});
