import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRID_H, GRID_W, MAX_ACTIONS, MAX_ROUNDS, SESSION_TTL, SPIRAL_RADIUS } from './constants.js';
import { tickCombatCooldowns } from './cooldowns.js';
import { hexDistance, hexNeighbors, nextStepToward, posFromXY, xy } from './grid.js';
import { adjustedApCost } from './resources.js';
import { resolveJutsu } from './resolveJutsu.js';
import {
    addCombatStatus,
    capCombatStatusStacks,
    countActiveCombatStatuses,
    hasCombatStatus,
    isCombatStatusActive,
    sumActiveCombatStatusPercent,
    tickCombatStatuses,
} from './statuses.js';
import { masteryDamageFraction } from './formulas.js';
import type { CombatStatus } from './types.js';

test('combat-core constants pin the PvP grid and turn envelope', () => {
    assert.equal(GRID_W, 12);
    assert.equal(GRID_H, 10);
    assert.equal(MAX_ROUNDS, 25);
    assert.equal(MAX_ACTIONS, 5);
    assert.equal(SPIRAL_RADIUS, 2);
    assert.equal(SESSION_TTL, 15 * 60);
});

test('hex helpers preserve the arena odd-column geometry', () => {
    assert.deepEqual(xy(13), { x: 1, y: 1 });
    assert.equal(posFromXY(1, 1), 13);
    assert.equal(posFromXY(-1, 1), -1);
    assert.deepEqual(hexNeighbors(0), [1, 12]);
    assert.deepEqual(hexNeighbors(13), [26, 14, 1, 12, 24, 25]);
    assert.equal(hexDistance(0, 13), 2);
    assert.equal(nextStepToward(0, 13), 1);
});

test('combat status timing stays deferred until activeRound', () => {
    assert.equal(isCombatStatusActive({}, 1), true);
    assert.equal(isCombatStatusActive({ activeRound: 1 }, 1), true);
    assert.equal(isCombatStatusActive({ activeRound: 2 }, 1), false);
});

test('status helpers preserve add/replace/stack/tick semantics', () => {
    const oldBurn: CombatStatus = { name: 'Burn', rounds: 1, percent: 10, kind: 'negative' };
    const newBurn: CombatStatus = { name: 'Burn', rounds: 3, percent: 20, kind: 'negative' };
    const woundA: CombatStatus = { name: 'Wound', rounds: 2, amount: 20, kind: 'negative' };
    const woundB: CombatStatus = { name: 'Wound', rounds: 2, amount: 30, kind: 'negative' };
    const pending: CombatStatus = { name: 'Shield', rounds: 2, activeRound: 3, percent: 40, kind: 'positive' };
    const durationFor = (name: string, fallback: number) => name === 'Burn' ? 2 : fallback;
    const isStackable = (name: string) => name === 'Wound';

    let statuses = addCombatStatus([oldBurn, pending], newBurn, { durationFor, isStackable });
    assert.deepEqual(statuses.map(status => [status.name, status.rounds, status.percent]), [['Shield', 2, 40], ['Burn', 2, 20]]);

    statuses = addCombatStatus(statuses, woundA, { durationFor, isStackable });
    statuses = addCombatStatus(statuses, woundB, { durationFor, isStackable });
    assert.equal(countActiveCombatStatuses(statuses, 'Wound', 1), 2);
    assert.equal(hasCombatStatus(statuses, 'Shield', 1), false);
    assert.equal(sumActiveCombatStatusPercent(statuses, 'Burn', 1), 20);

    const ticked = tickCombatStatuses(statuses, 1);
    assert.deepEqual(ticked.map(status => [status.name, status.rounds]), [['Shield', 2], ['Burn', 1], ['Wound', 1], ['Wound', 1]]);
});

test('status cap keeps the strongest recent stacks', () => {
    const statuses: CombatStatus[] = [
        { name: 'Wound', rounds: 2, amount: 10, kind: 'negative' },
        { name: 'Poison', rounds: 2, amount: 99, kind: 'negative' },
        { name: 'Wound', rounds: 2, amount: 30, kind: 'negative' },
        { name: 'Wound', rounds: 2, amount: 30, kind: 'negative' },
    ];
    const capped = capCombatStatusStacks(statuses, 'Wound', 2);
    assert.deepEqual(capped.map(status => [status.name, status.amount]), [['Poison', 99], ['Wound', 30], ['Wound', 30]]);
    assert.equal(capped.includes(statuses[3]!), true, 'ties keep the most recent stack');
});

test('cooldown and AP helpers preserve PvP turn math', () => {
    assert.deepEqual(tickCombatCooldowns({ ready: 1, almost: 2, long: 5 }), { almost: 1, long: 4 });
    assert.equal(adjustedApCost(60), 60);
    assert.equal(adjustedApCost(60, { lagPct: 20 }), 72);
    assert.equal(adjustedApCost(60, { overclockPct: 20 }), 48);
    assert.equal(adjustedApCost(60, { lagPct: 20, overclockPct: 20 }), 57);
    assert.equal(adjustedApCost(1, { overclockPct: 99 }), 1);
});

test('mastery fraction helper preserves the pinned ramp shape', () => {
    assert.equal(masteryDamageFraction(0, 50, 0.3), 0.3);
    assert.equal(masteryDamageFraction(50, 50, 0.3), 1);
    assert.equal(masteryDamageFraction(25, 50, 0.3), 0.6499999999999999);
});

test('resolveJutsu owns phase order while phase callbacks own formulas', () => {
    type ToyFighter = { id: string; hp: number; maxHp: number; shield: number; marker?: string };
    type ToyJutsu = { id: string };
    type ToyStats = { source: string };
    type ToyFx = { who: 'self' | 'opp'; amount: number; kind: 'damage' | 'heal' };

    const order: string[] = [];
    const self: ToyFighter = { id: 'self', hp: 40, maxHp: 100, shield: 0 };
    const opponent: ToyFighter = { id: 'opp', hp: 100, maxHp: 100, shield: 0 };
    const formulaSelf: ToyFighter = { ...self, marker: 'formula-self' };
    const formulaOpponent: ToyFighter = { ...opponent, marker: 'formula-opponent' };

    const result = resolveJutsu<ToyFighter, ToyJutsu, ToyStats, ToyFx>({
        self,
        opponent,
        formulaSelf,
        formulaOpponent,
        jutsu: { id: 'toy' },
        wMult: 1.25,
        biome: 'central',
        round: 4,
        masteryLevel: 12,
        healBoost: 1,
        phases: {
            resolveBaseDamage: (baseSelf, baseOpponent, jutsu, wMult, biome, round, masteryLevel) => {
                order.push('base');
                assert.equal(baseSelf.marker, 'formula-self');
                assert.equal(baseOpponent.marker, 'formula-opponent');
                assert.equal(jutsu.id, 'toy');
                assert.equal(wMult, 1.25);
                assert.equal(biome, 'central');
                assert.equal(round, 4);
                assert.equal(masteryLevel, 12);
                return { baseDmg: 10, effectiveDR: 0.25, offStats: { source: 'base' } };
            },
            resolveTagStatuses: (tagSelf, tagOpponent, jutsu, round, masteryLevel, baseDmg, healBoost) => {
                order.push('status');
                assert.equal(tagSelf.marker, undefined);
                assert.equal(tagOpponent.marker, undefined);
                assert.equal(jutsu.id, 'toy');
                assert.equal(round, 4);
                assert.equal(masteryLevel, 12);
                assert.equal(baseDmg, 10);
                assert.equal(healBoost, 1);
                return {
                    s: { ...tagSelf, marker: 'status-self' },
                    o: { ...tagOpponent, marker: 'status-opponent' },
                    lines: ['status line'],
                    damage: 15,
                    healing: 7,
                    shieldGain: 3,
                    pierce: false,
                };
            },
            resolveDamageNumber: (damageSelf, damageOpponent, jutsu, round, masteryLevel, offStats, damageIn, pierce, effectiveDR) => {
                order.push('damage');
                assert.equal(damageSelf.marker, undefined);
                assert.equal(damageOpponent.marker, undefined);
                assert.equal(jutsu.id, 'toy');
                assert.equal(round, 4);
                assert.equal(masteryLevel, 12);
                assert.deepEqual(offStats, { source: 'base' });
                assert.equal(damageIn, 15);
                assert.equal(pierce, false);
                assert.equal(effectiveDR, 0.25);
                return 11;
            },
            resolvePostDamage: (postSelf, postOpponent, jutsu, round, damage, pierce, healBoost) => {
                order.push('post');
                assert.equal(postSelf.marker, 'status-self');
                assert.equal(postOpponent.marker, 'status-opponent');
                assert.equal(jutsu.id, 'toy');
                assert.equal(round, 4);
                assert.equal(damage, 11);
                assert.equal(pierce, false);
                assert.equal(healBoost, 1);
                return {
                    s: postSelf,
                    o: { ...postOpponent, hp: postOpponent.hp - damage },
                    lines: ['post line'],
                    fx: [{ who: 'opp', amount: damage, kind: 'damage' }],
                };
            },
            applyHealing: (fighter, amount) => ({ ...fighter, hp: Math.min(fighter.maxHp, fighter.hp + amount) }),
            applyShield: (fighter, amount) => ({ ...fighter, shield: fighter.shield + amount }),
            makeHitFx: (who, amount, kind) => ({ who, amount, kind }),
        },
    });

    assert.deepEqual(order, ['base', 'status', 'damage', 'post']);
    assert.deepEqual(result.logLines, ['status line', 'post line']);
    assert.deepEqual(result.hitFx, [
        { who: 'opp', amount: 11, kind: 'damage' },
        { who: 'self', amount: 7, kind: 'heal' },
    ]);
    assert.equal(result.self.hp, 47);
    assert.equal(result.self.shield, 3);
    assert.equal(result.opponent.hp, 89);
    assert.deepEqual(result.metadata, {
        damage: 11,
        baseDamage: 10,
        effectiveDR: 0.25,
        pierce: false,
        healing: 7,
        shieldGain: 3,
        masteryLevel: 12,
    });
});
