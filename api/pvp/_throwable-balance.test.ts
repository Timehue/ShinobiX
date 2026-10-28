import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { applyDoTs, applyJutsu, poisonSpendDamage } from './move.js';
import { ITEM_CATALOG } from './_item-catalog.js';
import { v2JutsuResourceCost } from '../_combat-resources.js';
import type { PvpFighter } from './session.js';

// Equal stats, no armor/shields/buffs, neutral terrain. Only the throwable
// changes; weapon damage resolves at the wielder's rank mastery ceiling.
function fighter(name: string, level: number): PvpFighter {
    return {
        name, hp: 10000, maxHp: 10000, chakra: 10000, maxChakra: 10000,
        stamina: 10000, maxStamina: 10000, shield: 0, statuses: [], pos: 0,
        character: { name, level, stats: {}, jutsuMastery: [] },
    };
}

function throwAt(id: string, level = 100, defender = fighter('target', level)) {
    const item = ITEM_CATALOG[id]!;
    return applyJutsu(fighter('thrower', level), defender, {
        id: 'weapon', name: item.name, type: 'Bukijutsu', isUtility: false,
        weaponSwing: true, suppressBloodline: true, effectPower: item.weaponEp,
        ap: item.apCost, range: item.weaponRange ?? 4,
        tags: item.weaponEffect ? [{ name: item.weaponEffect, percent: item.weaponEffectValue }] : [],
    }, 1, 'central', 1).opponent;
}

describe('throwable roles: burst, delayed bleed, and exertion pressure', () => {
    it('retains the approved rare Senbon payload and current shelf price', () => {
        const senbon = ITEM_CATALOG['thrown-senbon']!;
        assert.equal(senbon.rarity, 'rare');
        assert.equal(senbon.cost, 1600);
        assert.equal(senbon.weaponEp, 10);
        assert.equal(senbon.weaponRange, 4);
    });
    for (const level of [1, 15, 30, 50, 100]) {
        it(`Shuriken wins on impact; Senbon wins with both bleeds at level ${level}`, () => {
            const shuriken = throwAt('thrown-shuriken', level);
            const senbon = throwAt('thrown-senbon', level);
            const dust = throwAt('thrown-serpent-dust', level);
            const burst = 10000 - shuriken.hp;
            const needleHit = 10000 - senbon.hp;
            const wound = senbon.statuses.find(status => status.name === 'Wound');
            assert.ok(burst > needleHit && needleHit > 10000 - dust.hp);
            assert.equal(shuriken.statuses.length, 0);
            assert.equal(wound?.amount, Math.floor(needleHit * 0.25));
            assert.equal(wound?.activeRound, 2);
            assert.equal(wound?.rounds, 2);
            assert.equal(applyDoTs(senbon, 1).fighter.hp, senbon.hp, 'no bleed on the casting round');
            const firstTick = applyDoTs(senbon, 2).fighter;
            const secondTick = applyDoTs(firstTick, 3).fighter;
            assert.ok(10000 - secondTick.hp > burst, 'two delayed bleeds earn more total damage');
            assert.ok(10000 - secondTick.hp < burst * 1.1, 'the delayed advantage stays modest');
        });
    }

    it('level-100 Senbon lands 640 damage plus two 160 bleeds, versus 896 Shuriken damage', () => {
        const senbon = throwAt('thrown-senbon');
        assert.equal(10000 - throwAt('thrown-shuriken').hp, 896);
        assert.equal(10000 - senbon.hp, 640);
        assert.equal(10000 - applyDoTs(applyDoTs(senbon, 2).fighter, 3).fighter.hp, 960);
    });

    it('a fully shielded Senbon hit cannot create a bleed', () => {
        const defender = { ...fighter('target', 100), shield: 10000 };
        const senbon = throwAt('thrown-senbon', 100, defender);
        assert.equal(senbon.hp, defender.hp);
        assert.ok(!senbon.statuses.some(status => status.name === 'Wound'));
    });

    it('Dust keeps a light hit and charges poison only for resource spending, starting next round', () => {
        const dust = throwAt('thrown-serpent-dust');
        assert.equal(10000 - dust.hp, 320);
        const poison = dust.statuses.find(status => status.name === 'Poison');
        assert.equal(poison?.percent, 6);
        assert.equal(poison?.rounds, 2);
        assert.equal(poison?.activeRound, 2);
        assert.equal(poisonSpendDamage(dust, 100, 1), 0);
        assert.equal(poisonSpendDamage(dust, 0, 2), 0, 'free casts do not trigger poison');
        assert.equal(poisonSpendDamage(dust, 100, 2), 72);
        assert.equal(applyDoTs(dust, 2).fighter.hp, dust.hp, 'no passive poison tick');
    });

    it('Dust rewards sustained casting pressure over two rounds at level 100', () => {
        const dust = throwAt('thrown-serpent-dust');
        const bigCast = poisonSpendDamage(dust, v2JutsuResourceCost(60, 100), 2);
        const smallCast = poisonSpendDamage(dust, v2JutsuResourceCost(40, 100), 2);
        const direct = 10000 - dust.hp;
        assert.equal(direct + bigCast * 2, 824);
        assert.equal(direct + (bigCast + smallCast) * 2, 1076);
    });
});
