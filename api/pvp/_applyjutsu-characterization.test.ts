/*
 * Characterization snapshot for applyJutsu (api/pvp/move.ts).
 *
 * Pins the EXACT numeric outcomes of the damage / heal / shield / post-damage
 * pipeline for a matrix of representative casts. This is the safety net for the
 * phase-split refactor (#4): the resolution order is load-bearing, so these
 * values must not move when the engine is reorganized into explicit stages.
 * If a number here changes, the refactor changed behaviour — stop and look.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyJutsu } from './move.js';
import { sanitizeJutsuList, type PvpFighter, type PvpStatus } from './session.js';

function fighter(name: string, hp = 1000, statuses: PvpStatus[] = [], extra: Partial<PvpFighter> = {}): PvpFighter {
    return {
        name, hp, maxHp: 1000, chakra: 1000, maxChakra: 1000,
        stamina: 1000, maxStamina: 1000, shield: 0, statuses, pos: 0,
        character: { name, stats: {}, jutsuMastery: [] }, ...extra,
    };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// EP 90 is chosen so that at mastery 0 the steep ramp yields the SAME reference
// base these pipeline assertions were written against: epAtMax = 90 + 10 = 100,
// masteryFrac(0) = 0.3, scaledEp = 30 → 30 × 32 = 960. (Pre-ramp this was a plain
// EP-30 jutsu; the fixture EP was bumped so the downstream shield/DR/siphon/amp
// math — the actual subject of this characterization — stays pinned at 960.)
function jutsu(tags: Array<{ name: string; percent?: number }>, overrides: Record<string, unknown> = {}): any {
    return {
        id: 't', name: 't', type: 'Ninjutsu', element: 'Fire',
        ap: 60, range: 1, effectPower: 90, cooldown: 0,
        chakraCost: 0, staminaCost: 0, target: 'OPPONENT', method: 'SINGLE',
        tags, ...overrides,
    };
}

describe('applyJutsu characterization — base damage', () => {
    it('plain jutsu (960 reference base) vs empty-stats fighter deals exactly 960', () => {
        const r = applyJutsu(fighter('A'), fighter('B'), jutsu([]), 1, 'central', 1);
        assert.equal(r.opponent.hp, 1000 - 960);
        assert.equal(r.self.hp, 1000);
    });

    it('shield blocks before HP: 500 shield absorbs, 460 lands', () => {
        const r = applyJutsu(fighter('A'), fighter('B', 1000, [], { shield: 500 }), jutsu([]), 1, 'central', 1);
        assert.equal(r.opponent.hp, 1000 - 460);
        assert.equal(r.opponent.shield, 0);
    });
});

describe('applyJutsu characterization — heal / shield / siphon', () => {
    /*
     * CHANGED 2026-08-16 (owner ruling): Heal/Shield no longer zero the cast. This
     * fixture is a 60-AP DAMAGE jutsu, so it now lands its full 960 AND heals or
     * shields — the tag is a payload, not a trade. The 40-AP utility split is
     * untouched and enforced upstream (isZeroDamageFortyApJutsu gives a utility
     * scaledEp 0 before tags are walked), so a real support jutsu still hits for
     * nothing; see api/pvp/_weapon-damage.test.ts for that direction.
     */
    it('Heal ramps by jutsu mastery (225 at mastery 0, hard-capped at 750/maxHp) and KEEPS its damage', () => {
        const r = applyJutsu(fighter('A', 500), fighter('B'), jutsu([{ name: 'Heal' }]), 1, 'central', 1);
        assert.equal(r.self.hp, 725);           // 500 + floor(750 × masteryFrac(0)=0.3)=225; a maxed jutsu heals the full 750
        assert.equal(r.opponent.hp, 1000 - 960); // a 60-AP damage cast still lands its reference base
    });

    it('Shield ramps by jutsu mastery (225 at mastery 0, hard-capped at 750) and KEEPS its damage', () => {
        const r = applyJutsu(fighter('A'), fighter('B'), jutsu([{ name: 'Shield' }]), 1, 'central', 1);
        assert.equal(r.self.shield, 225);       // floor(750 × masteryFrac(0)=0.3); a maxed jutsu grants the full 750
        assert.equal(r.opponent.hp, 1000 - 960);
    });

    it('Siphon mastery-scales its stored 30% to 20% at level 0: 960 → +192', () => {
        const r = applyJutsu(fighter('A', 500), fighter('B'), jutsu([{ name: 'Siphon', percent: 30 }]), 1, 'central', 1);
        assert.equal(r.opponent.hp, 1000 - 960);
        assert.equal(r.self.hp, 500 + 192);
    });

    it('Wound mastery-scales its stored 30% to 20% before the basic-rank cap: amount 192', () => {
        const r = applyJutsu(fighter('A'), fighter('B'), jutsu([{ name: 'Wound', percent: 30 }]), 1, 'central', 1);
        const wound = r.opponent.statuses.find(s => s.name === 'Wound');
        assert.equal(wound?.amount, 192);       // cappedPostDamage(960, effective 20)
        assert.equal(wound?.activeRound, 2);    // deferred to next round
    });

    it('Wound stacks are capped at 2 — a 3rd cast does not add a 3rd ticking stack', () => {
        const woundJutsu = jutsu([{ name: 'Wound', percent: 30 }]);
        let def = fighter('B');
        for (let i = 0; i < 3; i++) {
            const r = applyJutsu(fighter('A'), def, woundJutsu, 1, 'central', 1);
            def = { ...r.opponent, hp: 1000 };  // refill so the target survives all 3 casts
        }
        assert.equal(def.statuses.filter(s => s.name === 'Wound').length, 2);
    });
});

describe('applyJutsu characterization — post-damage reactions', () => {
    it('defender Reflect 50% bounces 480 back to the attacker', () => {
        const def = fighter('B', 1000, [{ name: 'Reflect', rounds: 2, percent: 50, kind: 'positive' }]);
        const r = applyJutsu(fighter('A'), def, jutsu([]), 1, 'central', 1);
        assert.equal(r.opponent.hp, 1000 - 960);
        assert.equal(r.self.hp, 1000 - 480);
    });

    it('defender Absorb 50% heals 480 of the 960 taken (net -480)', () => {
        const def = fighter('B', 1000, [{ name: 'Absorb', rounds: 2, percent: 50, kind: 'positive' }]);
        const r = applyJutsu(fighter('A'), def, jutsu([]), 1, 'central', 1);
        assert.equal(r.opponent.hp, 1000 - 960 + 480);
    });

    it('Pierce deals a 100 true-damage floor through shield, no reflect', () => {
        const def = fighter('B', 1000, [{ name: 'Reflect', rounds: 2, percent: 50, kind: 'positive' }], { shield: 500 });
        const r = applyJutsu(fighter('A'), def, jutsu([{ name: 'Pierce' }], { ap: 60 }), 1, 'central', 1);
        assert.equal(r.opponent.hp, 1000 - 100);
        assert.equal(r.self.hp, 1000);
    });
});

describe('applyJutsu characterization — amp / DR pools', () => {
    it('attacker Increase Damage Given 35% soft-caps the 960 base to 1355', () => {
        const atk = fighter('A', 1000, [{ name: 'Increase Damage Given', rounds: 2, percent: 35, kind: 'positive' }]);
        // High-HP defender so the (>1000) hit is observable, not clamped at 0.
        const def = fighter('B', 3000, [], { maxHp: 3000 });
        const r = applyJutsu(atk, def, jutsu([]), 1, 'central', 1);
        // ampMult = 1 + 0.35/(0.35+0.5) = 1.4117..; 960 × 1.4117 = 1355.29 → floor 1355
        assert.equal(3000 - r.opponent.hp, 1355);
    });

    it('defender Decrease Damage Taken 35% soft-caps mitigation: 681 lands', () => {
        const def = fighter('B', 1000, [{ name: 'Decrease Damage Taken', rounds: 2, percent: 35, kind: 'positive' }]);
        const r = applyJutsu(fighter('A'), def, jutsu([]), 1, 'central', 1);
        // effDR = 0.35/(0.35+0.5) = 0.41176; 960 × (1-0.41176) = 564.7 → floor 564
        assert.equal(r.opponent.hp, 1000 - 564);
    });

    it('Overload applies both IDG pulses at 21% mastery-8 and 30% max mastery', () => {
        // The live authored shape: a 40 AP SELF utility whose TWO independent
        // Increase Damage Given pulses are both written into the record, and
        // which the trusted seal preserves rather than deduping to one.
        const rawOverload = jutsu([
            { name: 'Increase Damage Given', percent: 30 },
            { name: 'Increase Damage Given', percent: 30 },
        ], {
            id: 'admin-99c8efb8-8fa2-4b28-98d1-b95ad81af554',
            name: 'Overload',
            ap: 40,
            effectPower: 0,
            target: 'SELF',
            isUtility: true,
        });
        const overload = sanitizeJutsuList([rawOverload], {
            trustedDuplicateTagJutsuIds: new Set([rawOverload.id]),
        })[0] as ReturnType<typeof jutsu>;
        const castAt = (masteryLevel: number) => applyJutsu(
            fighter('A', 1000, [], {
                character: {
                    name: 'A',
                    level: 100,
                    stats: {},
                    jutsuMastery: [{ jutsuId: overload.id, level: masteryLevel }],
                },
            }),
            fighter('B'),
            overload,
            1,
            'central',
            1,
        );

        const mastery8 = castAt(8);
        const mastery8Stacks = mastery8.self.statuses.filter((status) => status.name === 'Increase Damage Given');
        assert.deepEqual(mastery8Stacks.map((status) => status.percent), [21, 21]);
        assert.deepEqual(
            mastery8.lines.filter((line) => line.startsWith('+21% Damage Given')),
            [
                '+21% Damage Given (stack 1/2): A for 2 turns.',
                '+21% Damage Given (stack 2/2): A for 2 turns.',
            ],
        );
        const mastery8FollowUp = applyJutsu(
            mastery8.self,
            fighter('B', 3000, [], { maxHp: 3000 }),
            jutsu([]),
            1,
            'central',
            2,
        );
        assert.equal(3000 - mastery8FollowUp.opponent.hp, 1398);

        const mastery50 = castAt(50);
        const mastery50Stacks = mastery50.self.statuses.filter((status) => status.name === 'Increase Damage Given');
        assert.deepEqual(mastery50Stacks.map((status) => status.percent), [30, 30]);
        assert.deepEqual(
            mastery50.lines.filter((line) => line.startsWith('+30% Damage Given')),
            [
                '+30% Damage Given (stack 1/2): A for 2 turns.',
                '+30% Damage Given (stack 2/2): A for 2 turns.',
            ],
        );
        const mastery50FollowUp = applyJutsu(
            mastery50.self,
            fighter('B', 3000, [], { maxHp: 3000 }),
            jutsu([]),
            1,
            'central',
            2,
        );
        assert.equal(3000 - mastery50FollowUp.opponent.hp, 1483);
    });
});
