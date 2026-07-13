/**
 * Regression guard: PvP weapon attacks must deal damage (api/pvp/move.ts).
 *
 * The bug: hand weapons omit `apCost`, so the weapon synth got `ap: 40` (the
 * default). With no `isUtility` flag, that tripped the legacy 40-AP "zero-damage
 * utility" rule (isZeroDamageFortyApJutsu) and the weapon dealt ZERO base damage
 * in PvP — while PvE was exempt (its synth uses an 'item-' id). The fix sets
 * `isUtility: false` on the weapon synth. These tests pin BOTH directions:
 *   • a weapon (isUtility:false, ap:40) deals weaponEp-scaled damage, and
 *   • a genuine 40-AP utility jutsu (isUtility undefined, non-exempt id) still
 *     deals zero damage — so the fix didn't disable the utility rule itself.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyJutsu, characterOwnsElement } from './move.js';
import type { PvpFighter } from './session.js';

function fighter(name: string, hp = 1000): PvpFighter {
    return {
        name,
        hp,
        maxHp: 1000,
        chakra: 1000,
        maxChakra: 1000,
        stamina: 1000,
        maxStamina: 1000,
        shield: 0,
        statuses: [],
        pos: 0,
        character: { name, stats: {}, jutsuMastery: [] },
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asJutsu(j: Record<string, unknown>): any {
    return { type: 'Bukijutsu', range: 1, cooldown: 0, chakraCost: 0, staminaCost: 0, target: 'OPPONENT', method: 'SINGLE', tags: [], ...j };
}

describe('PvP weapon damage', () => {
    it('a 40-AP weapon (isUtility:false) deals weaponEp-scaled damage', () => {
        const self = fighter('A');
        const opp = fighter('B');
        // Mirrors the weapon synth in move.ts: id 'weapon', ap 40, isUtility false.
        const r = applyJutsu(self, opp, asJutsu({ id: 'weapon', name: 'Katana', isUtility: false, ap: 40, effectPower: 18 }), 1, 'central', 1);
        assert.ok(r.opponent.hp < 1000, `weapon should deal damage, opponent hp=${r.opponent.hp}`);
    });

    it('a genuine 40-AP utility jutsu still deals ZERO base damage (rule intact)', () => {
        const self = fighter('A');
        const opp = fighter('B');
        const r = applyJutsu(self, opp, asJutsu({ id: 'buff-x', name: 'Utility', ap: 40, effectPower: 18 }), 1, 'central', 1);
        assert.equal(r.opponent.hp, 1000, 'a 40-AP non-exempt jutsu with no isUtility flag must deal 0 base damage');
    });

    it('the basic attack (id basic-attack, ap 40) still deals damage', () => {
        const self = fighter('A');
        const opp = fighter('B');
        const r = applyJutsu(self, opp, asJutsu({ id: 'basic-attack', name: 'Basic Attack', ap: 40, effectPower: 10 }), 1, 'central', 1);
        assert.ok(r.opponent.hp < 1000, `basic attack should deal damage, opponent hp=${r.opponent.hp}`);
    });

    it('a weapon carrying an Increase Generals tag applies the self-buff (named-weapon roll path)', () => {
        const self = fighter('A');
        const opp = fighter('B');
        // Named weapons carry weaponTags → move.ts builds a weaponJutsu with those tags
        // (id 'weapon', isUtility:false) → applyJutsu resolves them. Prove the rolled
        // Increase Generals tag lands as a buff on the wielder AND the weapon still hits.
        const r = applyJutsu(self, opp, asJutsu({ id: 'weapon', name: 'Named Blade', isUtility: false, ap: 40, effectPower: 18, tags: [{ name: 'Increase Generals', percent: 35 }] }), 1, 'central', 1);
        const st = r.self.statuses.find(s => s.name === 'Increase Generals');
        assert.ok(st, "the weapon's Increase Generals tag should apply a status to the wielder");
        assert.equal(st?.rounds, 2, 'buff lasts 2 rounds');
        assert.ok(r.opponent.hp < 1000, 'the weapon still deals its damage');
    });
});

describe('weapon → bloodline multiplier gate (suppressBloodline)', () => {
    // A wielder whose bloodline multiplies damage ×1.5 and who has awakened Fire.
    function blFighter(): PvpFighter {
        const f = fighter('BL');
        f.character = { name: 'BL', stats: {}, jutsuMastery: [], bloodlineMult: 1.5, elements: ['Fire'] };
        return f;
    }

    it('a weapon swing WITHOUT suppressBloodline rides the bloodline mult; WITH it does not', () => {
        const oppBoost = fighter('D1');
        const oppGated = fighter('D2');
        const boosted = applyJutsu(blFighter(), oppBoost, asJutsu({ id: 'weapon', name: 'Blade', isUtility: false, ap: 40, effectPower: 30 }), 1, 'central', 1);
        const gated = applyJutsu(blFighter(), oppGated, asJutsu({ id: 'weapon', name: 'Blade', isUtility: false, ap: 40, effectPower: 30, suppressBloodline: true }), 1, 'central', 1);
        assert.ok(boosted.opponent.hp < 1000, 'the bloodline-boosted weapon deals damage');
        assert.ok(gated.opponent.hp < 1000, 'the gated weapon still deals its (unboosted) damage');
        assert.ok(gated.opponent.hp > boosted.opponent.hp, `suppressBloodline must strip the bloodline mult (boosted hp=${boosted.opponent.hp}, gated hp=${gated.opponent.hp})`);
    });
});

describe('characterOwnsElement (weapon element ownership)', () => {
    it('matches an awakened element case-insensitively, from elements[] or element', () => {
        assert.equal(characterOwnsElement({ elements: ['Fire', 'Water'] }, 'fire'), true);
        assert.equal(characterOwnsElement({ element: 'Lightning' }, 'Lightning'), true);
        assert.equal(characterOwnsElement({ elements: ['Wind'] }, 'Earth'), false);
    });
    it('an empty / missing / "None" weapon element never qualifies (no-element weapon → no boost)', () => {
        assert.equal(characterOwnsElement({ elements: ['Fire'] }, ''), false);
        assert.equal(characterOwnsElement({ elements: ['Fire'] }, undefined), false);
        assert.equal(characterOwnsElement({ elements: ['Fire'] }, 'None'), false);
    });
    it('a character with no elements owns nothing', () => {
        assert.equal(characterOwnsElement({}, 'Fire'), false);
        assert.equal(characterOwnsElement(null, 'Fire'), false);
    });
});
