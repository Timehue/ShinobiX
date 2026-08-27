import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { maxHpForLevel } from '../_xp-engine.js';
import { makePvpFighter } from './session.js';
import {
    humanPvpHpMultiplier,
    pvpSessionHp,
} from './_low-level-hp.js';

describe('human PvP low-level HP scaling', () => {
    it('applies the full bonus through level 10 and fades exactly to zero at 25', () => {
        assert.equal(humanPvpHpMultiplier(1), 1.5);
        assert.equal(humanPvpHpMultiplier(10), 1.5);
        assert.equal(humanPvpHpMultiplier(15), 1 + 0.5 * (10 / 15));
        assert.equal(humanPvpHpMultiplier(20), 1 + 0.5 * (5 / 15));
        assert.equal(humanPvpHpMultiplier(25), 1);
        assert.equal(humanPvpHpMultiplier(80), 1);
        assert.equal(humanPvpHpMultiplier(undefined), 1, 'missing authoritative level gets no bonus');
        assert.equal(humanPvpHpMultiplier(null), 1, 'malformed authoritative level gets no bonus');
    });

    it('projects a fresh level-10 human from 1,400 to 2,100 HP', () => {
        assert.deepEqual(pvpSessionHp({
            level: 10,
            currentHp: 350,
            maxHp: 1_400,
            useCurrentVitals: false,
            humanPvp: true,
        }), { hp: 2_100, maxHp: 2_100 });
    });

    it('keeps the resulting canonical level curve monotonic through the fade', () => {
        let previous = 0;
        for (let level = 1; level <= 25; level += 1) {
            const maxHp = maxHpForLevel(level);
            const projected = pvpSessionHp({
                level,
                currentHp: maxHp,
                maxHp,
                useCurrentVitals: false,
                humanPvp: true,
            });
            assert.ok(projected.maxHp >= previous, `level ${level} must not lose PvP HP`);
            previous = projected.maxHp;
        }
    });

    it('preserves current-HP ratio in continuous-vitals PvP', () => {
        assert.deepEqual(pvpSessionHp({
            level: 10,
            currentHp: 350,
            maxHp: 1_400,
            useCurrentVitals: true,
            humanPvp: true,
        }), { hp: 525, maxHp: 2_100 });
    });

    it('does not scale PvP-engine AI encounters or level-25 human PvP', () => {
        assert.deepEqual(pvpSessionHp({
            level: 10,
            currentHp: 350,
            maxHp: 1_400,
            useCurrentVitals: true,
            humanPvp: false,
        }), { hp: 350, maxHp: 1_400 });
        assert.deepEqual(pvpSessionHp({
            level: 10,
            currentHp: 350,
            maxHp: 1_400,
            useCurrentVitals: false,
            humanPvp: false,
        }), { hp: 1_400, maxHp: 1_400 });
        assert.deepEqual(pvpSessionHp({
            level: 25,
            currentHp: 1_450,
            maxHp: 2_900,
            useCurrentVitals: true,
            humanPvp: true,
        }), { hp: 1_450, maxHp: 2_900 });
    });

    it('changes only the session fighter and leaves canonical character HP untouched', () => {
        const character = {
            name: 'Academy Human',
            level: 10,
            hp: 700,
            maxHp: 1_400,
            chakra: 1_000,
            maxChakra: 1_000,
            stamina: 1_000,
            maxStamina: 1_000,
        };
        const fighter = makePvpFighter(character, 0, true, true);

        assert.equal(fighter.hp, 1_050);
        assert.equal(fighter.maxHp, 2_100);
        assert.equal(fighter.character, character);
        assert.equal(character.hp, 700);
        assert.equal(character.maxHp, 1_400);
    });
});
