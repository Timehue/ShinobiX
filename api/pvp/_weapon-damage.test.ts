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
import { WEAPON_AMP_TAG_CAP } from '../combat-core/formulas.js';
import { ITEM_CATALOG } from './_item-catalog.js';
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
    const out: Record<string, unknown> = { type: 'Bukijutsu', range: 1, cooldown: 0, chakraCost: 0, staminaCost: 0, target: 'OPPONENT', method: 'SINGLE', tags: [], ...j };
    return out.id === 'weapon' ? { ...out, weaponSwing: true } : out;
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

/*
 * The second zero-damage weapon bug (same shape as the 40-AP one above).
 *
 * Heal / Shield / Barrier zero the direct damage in resolveTagStatuses — correct
 * for a support JUTSU (it heals OR hits, never both), catastrophic for a weapon
 * SWING, whose tag is supposed to ride on top of its weaponEp damage. Named
 * weapons roll their tags from craft/_named.ts WEAPON_TAGS, which contains both
 * 'Heal' and 'Shield' (~1 forge in 4), and two BUILT-IN weapons ship
 * weaponEffect "Shield". Every one of them swung for exactly 0 in PvP and in
 * every server-run PvE mode. The carve-out keys off `isUtility: false` — the
 * flag every weapon synth already sets.
 */
describe('weapon damage survives Heal/Shield tags', () => {
    for (const tagName of ['Heal', 'Shield'] as const) {
        it(`a weapon carrying a ${tagName} tag still deals its weaponEp damage`, () => {
            const self = fighter('A', 500);
            const opp = fighter('B');
            const r = applyJutsu(self, opp, asJutsu({
                id: 'weapon', name: 'Named Blade', isUtility: false, ap: 40, effectPower: 30,
                tags: [{ name: tagName, percent: 37 }],
            }), 1, 'central', 1);
            assert.ok(r.opponent.hp < 1000, `a ${tagName} weapon must still hit, opponent hp=${r.opponent.hp}`);
        });
    }

    it('the Heal tag still heals the wielder on top of the damage', () => {
        const r = applyJutsu(fighter('A', 500), fighter('B'), asJutsu({
            id: 'weapon', name: 'Named Blade', isUtility: false, ap: 40, effectPower: 30,
            tags: [{ name: 'Heal', percent: 37 }],
        }), 1, 'central', 1);
        assert.ok(r.self.hp > 500, `the wielder should be healed, hp=${r.self.hp}`);
        assert.ok(r.opponent.hp < 1000, 'and the swing still lands');
    });

    it('the Shield tag still shields the wielder on top of the damage', () => {
        const r = applyJutsu(fighter('A'), fighter('B'), asJutsu({
            id: 'weapon', name: 'Frostfang Oathblade', isUtility: false, ap: 40, effectPower: 27,
            tags: [{ name: 'Shield', percent: 30 }],
        }), 1, 'central', 1);
        assert.ok(r.self.shield > 0, `the wielder should gain shield, shield=${r.self.shield}`);
        assert.ok(r.opponent.hp < 1000, 'and the swing still lands');
    });

    /*
     * The 40-AP utility / 60-AP damage split is the rule that actually decides
     * whether a cast deals damage, and it is enforced upstream: a utility cast
     * gets scaledEp 0 from isZeroDamageFortyApJutsu before tags are walked. So
     * Heal/Shield no longer need to zero anything — and MUST not, or they punish
     * the 60-AP damage jutsu that merely also heals (owner ruling 2026-08-16).
     */
    it('a 40-AP utility jutsu with Heal still deals ZERO damage (the split holds)', () => {
        const r = applyJutsu(fighter('A', 500), fighter('B'), asJutsu({
            id: 'medical-palm', name: 'Mystic Palm', ap: 40, effectPower: 30,
            tags: [{ name: 'Heal', percent: 37 }],
        }), 1, 'central', 1);
        assert.equal(r.opponent.hp, 1000, 'a 40-AP utility heals only');
        assert.ok(r.self.hp > 500, 'and it still heals');
    });

    it('a 60-AP DAMAGE jutsu with Heal keeps its full damage AND heals', () => {
        const tagged = applyJutsu(fighter('A', 500), fighter('B'), asJutsu({
            id: 'blast', name: 'Blast', ap: 60, effectPower: 30,
            tags: [{ name: 'Heal', percent: 37 }],
        }), 1, 'central', 1);
        const plain = applyJutsu(fighter('A', 500), fighter('B'), asJutsu({
            id: 'blast', name: 'Blast', ap: 60, effectPower: 30,
        }), 1, 'central', 1);
        assert.equal(tagged.opponent.hp, plain.opponent.hp, 'the Heal tag must not cost the cast its damage');
        assert.ok(tagged.opponent.hp < 1000, 'and it really is damaging');
        assert.ok(tagged.self.hp > 500, 'and the caster is healed on top');
    });

    it('Barrier still zeroes the cast — it is board control, not a payload', () => {
        const r = applyJutsu(fighter('A'), fighter('B'), asJutsu({
            id: 'blast', name: 'Wall', ap: 60, effectPower: 30,
            tags: [{ name: 'Barrier' }],
        }), 1, 'central', 1);
        assert.equal(r.opponent.hp, 1000, 'a Barrier cast places a wall instead of hitting');
    });

    it('EVERY built-in hand/thrown weapon deals non-zero damage', () => {
        const duds: string[] = [];
        for (const [id, item] of Object.entries(ITEM_CATALOG as Record<string, Record<string, unknown>>)) {
            const slot = String(item.slot ?? '');
            if (slot !== 'hand' && slot !== 'thrown' && slot !== 'weapon') continue;
            // Mirrors the weapon synth: weaponEffect becomes the swing's tag.
            const tags = item.weaponEffect
                ? [{ name: String(item.weaponEffect), percent: Number(item.weaponEffectValue ?? 0) }]
                : [];
            const r = applyJutsu(fighter('A'), fighter('B'), asJutsu({
                id: 'weapon', name: String(item.name), isUtility: false,
                ap: Number(item.apCost ?? 40), effectPower: Number(item.weaponEp ?? 15), tags,
            }), 1, 'central', 1);
            if (r.opponent.hp >= 1000) duds.push(id);
        }
        assert.deepEqual(duds, [], `these built-in weapons swing for zero: ${duds.join(', ')}`);
    });
});

/*
 * Weapon tag percents are exempt from the JUTSU-MASTERY ramp.
 *
 * scaledTagPercent docks (50 - mastery) × 0.2 points, and a weapon has no mastery
 * entry — it is permanently mastery 0, a flat -10. That made every 10%-effect
 * weapon (the entire common tier) completely inert and halved the rest, while the
 * item tooltip and the client's own weapon path both promised the authored value.
 * Owner ruling 2026-08-16: weapon swings resolve their percents at max mastery, so
 * the number printed on the item is the number the server applies. Jutsu scaling is
 * untouched — training a jutsu must still be worth it.
 */
describe('weapon tag percents ignore jutsu mastery', () => {
    const dmgGivenPct = (r: ReturnType<typeof applyJutsu>) =>
        r.opponent.statuses.find(s => s.name === 'Decrease Damage Given')?.percent;

    it('a weapon applies its authored percent; an untrained jutsu still pays the ramp', () => {
        const tags = [{ name: 'Decrease Damage Given', percent: 10 }];
        const weapon = applyJutsu(fighter('A'), fighter('B'), asJutsu({ id: 'weapon', name: 'Rustfang Kunai', isUtility: false, ap: 40, effectPower: 18, tags }), 1, 'central', 1);
        const jutsu = applyJutsu(fighter('A'), fighter('B'), asJutsu({ id: 'buff-x', name: 'Untrained Jutsu', ap: 40, effectPower: 18, tags }), 1, 'central', 1);
        assert.equal(dmgGivenPct(weapon), 10, 'the weapon applies the percent printed on the item');
        assert.equal(dmgGivenPct(jutsu), 0, 'an untrained jutsu still loses 10 points to the mastery ramp');
    });

    // A weapon has no bloodline rank, so ampTagCapForRank would floor it at the
    // no-bloodline 30 — which silently shaved the four mythic weapons that are
    // authored at 35 BY DESIGN. Owner ruling 2026-08-16: weapons answer to
    // WEAPON_AMP_TAG_CAP (35). A forged named weapon rolls 35-40 on a single-tag
    // result and clamps to 35, so crafted gear MATCHES the best built-in mythic
    // rather than beating it.
    it('a weapon amp tag reaches the authored mythic 35%', () => {
        const r = applyJutsu(fighter('A'), fighter('B'), asJutsu({
            id: 'weapon', name: 'Ashen Dragon Katana', isUtility: false, ap: 40, effectPower: 30,
            tags: [{ name: 'Absorb', percent: 35 }],
        }), 1, 'central', 1);
        assert.equal(r.self.statuses.find(s => s.name === 'Absorb')?.percent, 35, 'a mythic weapon delivers the 35% printed on it');
    });

    it('a weapon amp tag is still capped — a 40% forge roll lands at 35%', () => {
        const r = applyJutsu(fighter('A'), fighter('B'), asJutsu({
            id: 'weapon', name: 'Named Blade', isUtility: false, ap: 40, effectPower: 30,
            tags: [{ name: 'Increase Damage Given', percent: 40 }],
        }), 1, 'central', 1);
        assert.equal(r.self.statuses.find(s => s.name === 'Increase Damage Given')?.percent, WEAPON_AMP_TAG_CAP, 'a forged weapon cannot exceed the mythic ceiling');
    });

    it('the weapon ceiling does NOT leak into jutsu — bloodline ranks are untouched', () => {
        const tags = [{ name: 'Absorb', percent: 100 }];
        const none = applyJutsu(fighter('A'), fighter('B'), asJutsu({ id: 'blast', name: 'Blast', ap: 60, effectPower: 30, tags }), 1, 'central', 1);
        const sRank = applyJutsu(fighter('A'), fighter('B'), asJutsu({ id: 'blast', name: 'Blast', ap: 60, effectPower: 30, bloodlineRank: 'S Rank', tags }), 1, 'central', 1);
        assert.equal(none.self.statuses.find(s => s.name === 'Absorb')?.percent, 30, 'a no-bloodline jutsu still caps at 30');
        assert.equal(sRank.self.statuses.find(s => s.name === 'Absorb')?.percent, 40, 'an S-rank jutsu still caps at 40');
    });

    it('Wound and Siphon post-damage riders use the authored weapon value at max mastery, under weapon caps', () => {
        const r = applyJutsu(fighter('A', 100), fighter('B'), asJutsu({
            id: 'weapon', name: 'Named Blade', isUtility: false, ap: 40, effectPower: 30,
            tags: [{ name: 'Wound', percent: 20 }, { name: 'Siphon', percent: 40 }],
        }), 1, 'central', 1);
        assert.equal(
            r.opponent.statuses.find(status => status.name === 'Wound')?.amount,
            Math.floor(r.metadata.damage * 0.20),
            'the 20% printed Wound value is not docked to 10% for missing jutsu mastery',
        );
        assert.equal(
            r.self.hp - 100,
            Math.floor(r.metadata.damage * WEAPON_AMP_TAG_CAP / 100),
            'Siphon resolves at max mastery and clamps a 40% roll to the 35% weapon ceiling',
        );
    });

    it('the FLAT Heal magnitude still scales with real mastery (a swing is not a full heal jutsu)', () => {
        const r = applyJutsu(fighter('A', 100), fighter('B'), asJutsu({
            id: 'weapon', name: 'Named Blade', isUtility: false, ap: 40, effectPower: 30,
            tags: [{ name: 'Heal', percent: 37 }],
        }), 1, 'central', 1);
        const healed = r.self.hp - 100;
        assert.ok(healed > 0, 'the swing still heals');
        assert.ok(healed < 750, `a weapon heal stays below the maxed-jutsu HEAL_FLAT, got ${healed}`);
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
