/*
 * Owner tag rules (2026-10-05), pinned at the shared resolver that ranked/casual PvP,
 * solo PvE and Battle Towers all use (api/pvp/move.ts applyJutsu/applyDoTs):
 *   - Drain does its full amount no matter what (300 in ranked).
 *   - Wound on the Ranked Kunai bleeds 25% of the damage the hit caused.
 *   - Push and Pull move the target 4 tiles when there is room.
 * The end-of-turn timing and Cleanse rule are pinned through the live handler in
 * _move-handler.test.ts.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GRID_W } from '../combat-core/constants.js';
import { PUSH_PULL_TILES } from '../combat-core/formulas.js';
import { hexDistance } from '../combat-core/grid.js';
import { ITEM_CATALOG } from './_item-catalog.js';
import { applyDoTs, applyJutsu } from './move.js';
import type { PvpFighter, PvpStatus } from './session.js';

function fighter(name: string, pos: number, armorRawDR: number, jutsu: Record<string, unknown>[] = [], statuses: PvpStatus[] = []): PvpFighter {
    return {
        name, hp: 10_000, maxHp: 10_000, chakra: 5_000, maxChakra: 5_000, stamina: 5_000, maxStamina: 5_000,
        shield: 0, statuses, pos,
        character: {
            name, level: 100, specialty: 'Ninjutsu', armorRawDR,
            stats: { ninjutsuOffense: 2_500, ninjutsuDefense: 2_500, bukijutsuOffense: 2_500, bukijutsuDefense: 2_500, willpower: 2_500, speed: 2_500 },
            jutsu, jutsuMastery: jutsu.map(j => ({ jutsuId: j.id, level: 50 })),
        },
    };
}

// Every defense a ranked fighter can stack against a damage-over-time tick.
const DEFENSES: PvpStatus[] = [
    { name: 'Decrease Damage Taken', rounds: 2, percent: 30, kind: 'positive' },
    { name: 'Decrease Damage Taken', rounds: 2, percent: 20, source: 'item-defense-pill', kind: 'positive' },
];

const DRAIN = {
    id: 'drain', name: 'Drain', type: 'Ninjutsu', target: 'OPPONENT', range: 4, ap: 40,
    effectPower: 0, isUtility: true, tags: [{ name: 'Drain' }],
};
const STUN = {
    id: 'stun', name: 'Stun', type: 'Ninjutsu', target: 'OPPONENT', range: 4, ap: 40,
    effectPower: 0, isUtility: true, tags: [{ name: 'Stun' }],
};
function shove(name: 'Push' | 'Pull', range: number) {
    return {
        id: `${name.toLowerCase()}-${range}`, name, type: 'Ninjutsu', element: 'None', target: 'OPPONENT', range, ap: 40,
        effectPower: 0, isUtility: false, tags: [{ name, percent: 0 }],
    };
}

describe('Drain does its full amount no matter what', () => {
    it('a ranked 300 Drain logs 300 and lands 300 HP and chakra through max armor, DDT and a Defense Pill', () => {
        const cast = applyJutsu(fighter('alice', 0, 0.35, [DRAIN]), fighter('bob', 1, 0.35), DRAIN as never, 1, 'central', 1);
        assert.ok(cast.lines.includes('Drain: bob loses 300 HP+chakra/turn for 2 turns.'), cast.lines.join(' | '));
        const defended = { ...cast.opponent, statuses: [...cast.opponent.statuses, ...DEFENSES] };
        const tick = applyDoTs(defended, 2);
        assert.equal(tick.fighter.hp, defended.hp - 300);
        assert.equal(tick.fighter.chakra, defended.chakra - 300);
        assert.ok(tick.lines.includes('bob drained 300 HP+chakra.'), tick.lines.join(' | '));
    });
});

describe('the Ranked Kunai Wound bleeds 25% of the damage the hit caused', () => {
    const kunai = ITEM_CATALOG['ranked-format-kunai']!;
    const swing = {
        id: 'weapon', name: kunai.name, type: 'Bukijutsu', target: 'OPPONENT', range: 4, ap: kunai.apCost,
        isUtility: false, weaponSwing: true, effectPower: kunai.weaponEp, suppressBloodline: true,
        tags: [{ name: kunai.weaponEffect, percent: kunai.weaponEffectValue }],
    };

    it('stores 25% of the hit and ticks exactly that through armor and every defense', () => {
        assert.equal(kunai.weaponEffect, 'Wound');
        const target = fighter('bob', 1, 0.35);
        const hit = applyJutsu(fighter('alice', 0, 0.35), target, swing as never, 1, 'central', 1);
        const caused = target.hp - hit.opponent.hp;
        assert.ok(caused > 0, 'the kunai hits');
        const wound = hit.opponent.statuses.find(status => status.name === 'Wound')!;
        assert.equal(wound.amount, Math.floor(caused * 0.25));
        assert.ok(hit.lines.includes(`Wound: bob bleeds ${wound.amount}/turn for 2 turns.`), hit.lines.join(' | '));

        const defended = { ...hit.opponent, statuses: [...hit.opponent.statuses, ...DEFENSES] };
        const tick = applyDoTs(defended, 2);
        assert.equal(tick.fighter.hp, defended.hp - wound.amount!, 'armor does not cut the bleed a second time');
    });
});

describe('Push and Pull move the target 4 tiles when there is room', () => {
    // A hex near the board centre, so a 4-tile shove has room in every direction tested.
    const centre = 3 * GRID_W + Math.floor(GRID_W / 2);

    it('pins the distance at 4', () => {
        assert.equal(PUSH_PULL_TILES, 4);
    });

    it('a range-1 Push still moves the target 4 tiles away', () => {
        const caster = fighter('alice', centre, 0);
        const target = fighter('bob', centre + 1, 0);
        const cast = applyJutsu(caster, target, shove('Push', 1) as never, 1, 'central', 1);
        assert.equal(hexDistance(cast.opponent.pos, centre), hexDistance(target.pos, centre) + 4);
        assert.ok(cast.lines.includes('Push: bob is pushed 4 tile(s).'), cast.lines.join(' | '));
    });

    it('a range-5 Pull moves the target 4 tiles closer, not 5', () => {
        const caster = fighter('alice', centre - 3, 0);
        const target = fighter('bob', centre + 3, 0);
        const before = hexDistance(target.pos, caster.pos);
        const cast = applyJutsu(caster, target, shove('Pull', 5) as never, 1, 'central', 1);
        assert.equal(hexDistance(cast.opponent.pos, caster.pos), before - 4);
        assert.ok(cast.lines.includes('Pull: bob is pulled 4 tile(s).'), cast.lines.join(' | '));
    });

    it('a Pull stops beside the caster when there is no room for all 4', () => {
        const caster = fighter('alice', centre, 0);
        const target = fighter('bob', centre + 3, 0);
        const cast = applyJutsu(caster, target, shove('Pull', 5) as never, 1, 'central', 1);
        assert.equal(hexDistance(cast.opponent.pos, caster.pos), 1);
        assert.ok(cast.lines.includes('Pull: bob is pulled 2 tile(s).'), cast.lines.join(' | '));
    });
});

describe('cast lines', () => {
    it('says Stun lands next round, not next turn', () => {
        const cast = applyJutsu(fighter('alice', 0, 0, [STUN]), fighter('bob', 1, 0), STUN as never, 1, 'central', 1);
        assert.ok(cast.lines.includes('Stun: bob loses 40 AP on their turn next round.'), cast.lines.join(' | '));
    });
});
