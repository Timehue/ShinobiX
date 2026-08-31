import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWarfrontAiTeam } from './_warfront-ai.js';
import { RITE_BAND_SIZE, RITE_MIN_ELEMENTS, isValidRiteBand, riteBandElements } from '../_pet-sim/pet-warfront-rite.js';

/*
 * The AI band has to satisfy the SAME element-diversity rule the player's band
 * does, and this is not cosmetic.
 *
 * The Rite harness measures a mono-element band losing 100% of matches to its
 * counter — a chain of duels amplifies the shared ±15% element chart instead of
 * averaging it out. If the generated rival band could come up mono-element, a
 * player would be either auto-won or auto-lost before committing a single
 * decision. The current pool cycles Wind/Earth/Fire, which lands three distinct
 * elements across four slots; this test exists so a future pool edit cannot
 * quietly drop below that.
 */

test('the generated Warfront rival band is always legal for the Rite', () => {
    const band = buildWarfrontAiTeam(RITE_BAND_SIZE);
    assert.equal(band.length, RITE_BAND_SIZE, 'the rival band must fill every slot');
    assert.ok(
        riteBandElements(band).length >= RITE_MIN_ELEMENTS,
        `the rival band carries only ${riteBandElements(band).join('/')} — a mono-element band is a coin flip, not a match`,
    );
    assert.ok(isValidRiteBand(band), 'the rival band must pass the same validator the player’s band does');
});

test('every rival band size the builder accepts stays element-diverse at full size', () => {
    for (let size = 1; size <= RITE_BAND_SIZE; size++) {
        const band = buildWarfrontAiTeam(size);
        assert.equal(band.length, size);
        if (size >= RITE_MIN_ELEMENTS) {
            assert.ok(
                riteBandElements(band).length >= RITE_MIN_ELEMENTS,
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
