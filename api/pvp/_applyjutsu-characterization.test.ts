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
import type { PvpFighter, PvpStatus } from './session.js';

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
    it('Heal restores a flat 750 (capped at maxHp) and deals no damage', () => {
        const r = applyJutsu(fighter('A', 500), fighter('B'), jutsu([{ name: 'Heal' }]), 1, 'central', 1);
        assert.equal(r.self.hp, 1000);          // 500 + 750 capped at 1000
        assert.equal(r.opponent.hp, 1000);      // damage zeroed
    });

    it('Shield grants a flat 750 and deals no damage', () => {
        const r = applyJutsu(fighter('A'), fighter('B'), jutsu([{ name: 'Shield' }]), 1, 'central', 1);
        assert.equal(r.self.shield, 750);
        assert.equal(r.opponent.hp, 1000);
    });

    it('Siphon heals 30%-of-final on the SAME hit: 960 → +288', () => {
        const r = applyJutsu(fighter('A', 500), fighter('B'), jutsu([{ name: 'Siphon', percent: 30 }]), 1, 'central', 1);
        assert.equal(r.opponent.hp, 1000 - 960);
        assert.equal(r.self.hp, 500 + 288);
    });

    it('Wound seeds a deferred bleed capped at the basic rank (25%): amount 240', () => {
        const r = applyJutsu(fighter('A'), fighter('B'), jutsu([{ name: 'Wound', percent: 30 }]), 1, 'central', 1);
        const wound = r.opponent.statuses.find(s => s.name === 'Wound');
        assert.equal(wound?.amount, 240);       // cappedPostDamage(960, 25)
        assert.equal(wound?.activeRound, 2);    // deferred to next round
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
});
