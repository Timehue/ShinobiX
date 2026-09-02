/*
 * Elemental Seal end-to-end characterization.
 *
 * The tag has three moving parts that live in different files, and nothing
 * previously pinned them together:
 *   • application  — api/pvp/move.ts applyJutsu, a 1-round deferred debuff on
 *                    the OPPONENT, blocked by their Debuff Prevent
 *   • enforcement  — api/combat-core/resolve-jutsu-action.ts (PvP + solo PvE)
 *                    and api/towers/_engine.ts, which must agree on WHICH
 *                    elements are sealed
 *   • timing       — deferred activation, exactly one active round, then gone
 *
 * The card copy players read is "Prevents Fire, Water, Earth, Wind, and
 * Lightning jutsu use during the next combat round. … None and special/custom
 * elements remain usable." (shinobij.client/src/lib/jutsu-effects.ts). These
 * assertions are that sentence, executed.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyJutsu } from './move.js';
import type { PvpFighter, PvpStatus } from './session.js';
import { resolveJutsuActionPlan } from '../combat-core/resolve-jutsu-action.js';
import { tickCombatStatuses, activeCombatStatuses } from '../combat-core/statuses.js';
import { GRID_W, GRID_H } from '../combat-core/constants.js';

function fighter(name: string, statuses: PvpStatus[] = []): PvpFighter {
    return {
        name, hp: 1000, maxHp: 1000, chakra: 1000, maxChakra: 1000,
        stamina: 1000, maxStamina: 1000, shield: 0, statuses, pos: 0,
        character: { name, stats: {}, jutsuMastery: [] },
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sealJutsu(overrides: Record<string, unknown> = {}): any {
    return {
        id: 'seal-thread', name: 'Five-Color Seal Thread', type: 'Genjutsu', element: 'None',
        ap: 60, range: 4, effectPower: 23, cooldown: 3,
        chakraCost: 0, staminaCost: 0, target: 'OPPONENT', method: 'SINGLE',
        tags: [{ name: 'Elemental Seal', percent: 0 }], ...overrides,
    };
}

const BOARD = { width: GRID_W, height: GRID_H, unavailableTiles: new Set<number>() };

// A plain 40 AP OPPONENT cast with the caster and target adjacent, so nothing
// but the seal can reject it. Only `element` varies between cases.
function planFor(element: string, casterStatuses: PvpStatus[], round: number) {
    return resolveJutsuActionPlan({
        jutsu: {
            id: 'probe', name: 'Probe', type: 'Ninjutsu', element,
            ap: 40, range: 5, effectPower: 30, target: 'OPPONENT', method: 'SINGLE', tags: [],
        },
        casterPos: 0,
        opponentPos: 1,
        casterStatuses,
        round,
        casterChakra: 1000,
        casterStamina: 1000,
        availableAp: 100,
        actionsThisTurn: 0,
        cooldownRemaining: 0,
        board: BOARD,
    });
}

describe('Elemental Seal — application', () => {
    it('lands a 1-round debuff on the OPPONENT, deferred to next round', () => {
        const r = applyJutsu(fighter('A'), fighter('B'), sealJutsu(), 1, 'central', 3);

        assert.equal(r.self.statuses.length, 0, 'the caster does not seal themselves');
        const seal = r.opponent.statuses.find((status) => status.name === 'Elemental Seal');
        assert.ok(seal, 'the target is sealed');
        assert.equal(seal.kind, 'negative');
        assert.equal(seal.rounds, 1);
        assert.equal(seal.activeRound, 4, 'starts NEXT round, so it cannot rob the cast round');
        assert.equal(activeCombatStatuses(r.opponent.statuses, 3).length, 0, 'inert during the cast round');
        assert.equal(activeCombatStatuses(r.opponent.statuses, 4).length, 1, 'live on the next round');
    });

    it('is blocked by the target\'s Debuff Prevent', () => {
        const warded = fighter('B', [{ name: 'Debuff Prevent', rounds: 2, kind: 'positive' }]);
        const r = applyJutsu(fighter('A'), warded, sealJutsu(), 1, 'central', 3);
        assert.equal(r.opponent.statuses.some((status) => status.name === 'Elemental Seal'), false);
    });

    it('logs the seal so the battle log shows why casts start failing', () => {
        const r = applyJutsu(fighter('A'), fighter('B'), sealJutsu(), 1, 'central', 3);
        assert.ok(r.lines.some((line) => /Elemental Seal: B's elemental jutsu are sealed\./.test(line)));
    });
});

describe('Elemental Seal — what it blocks', () => {
    const sealed: PvpStatus[] = [{ name: 'Elemental Seal', rounds: 1, kind: 'negative', activeRound: 4 }];

    for (const element of ['Fire', 'Water', 'Earth', 'Wind', 'Lightning']) {
        it(`blocks a ${element} jutsu while active`, () => {
            const plan = planFor(element, sealed, 4);
            assert.equal(plan.accepted, false);
            assert.equal(plan.rejection, 'elementally-sealed');
        });
    }

    // The five BASIC elements only. A bloodline's special element is cosmetic-
    // but-real here: it is deliberately NOT sealed, which is what makes a
    // bloodline kit the answer to a seal rather than dead weight against it.
    for (const element of ['None', 'Blood', 'Lava', 'Shadow', 'Iron']) {
        it(`leaves a ${element} jutsu usable while active`, () => {
            assert.equal(planFor(element, sealed, 4).accepted, true);
        });
    }

    it('does not block anything during the cast round it was applied in', () => {
        assert.equal(planFor('Fire', sealed, 3).accepted, true);
    });
});

describe('Elemental Seal — expiry', () => {
    it('survives the cast-round tick, then expires after exactly one active round', () => {
        const applied = applyJutsu(fighter('A'), fighter('B'), sealJutsu(), 1, 'central', 3);
        let statuses = applied.opponent.statuses;

        // End of the cast round: a deferred status is not active yet, so it must
        // NOT be decremented — otherwise a 1-round seal would expire before it
        // ever applied.
        statuses = tickCombatStatuses(statuses, 3);
        assert.equal(statuses.filter((status) => status.name === 'Elemental Seal').length, 1);
        assert.equal(planFor('Fire', statuses, 4).accepted, false, 'live on round 4');

        // End of its one active round: gone.
        statuses = tickCombatStatuses(statuses, 4);
        assert.equal(statuses.filter((status) => status.name === 'Elemental Seal').length, 0);
        assert.equal(planFor('Fire', statuses, 5).accepted, true, 'usable again on round 5');
    });
});
