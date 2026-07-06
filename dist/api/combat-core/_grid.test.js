"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const constants_js_1 = require("./constants.js");
const cooldowns_js_1 = require("./cooldowns.js");
const grid_js_1 = require("./grid.js");
const resources_js_1 = require("./resources.js");
const resolveJutsu_js_1 = require("./resolveJutsu.js");
const statuses_js_1 = require("./statuses.js");
const formulas_js_1 = require("./formulas.js");
(0, node_test_1.test)('combat-core constants pin the PvP grid and turn envelope', () => {
    strict_1.default.equal(constants_js_1.GRID_W, 12);
    strict_1.default.equal(constants_js_1.GRID_H, 10);
    strict_1.default.equal(constants_js_1.MAX_ROUNDS, 25);
    strict_1.default.equal(constants_js_1.MAX_ACTIONS, 5);
    strict_1.default.equal(constants_js_1.SPIRAL_RADIUS, 2);
    strict_1.default.equal(constants_js_1.SESSION_TTL, 15 * 60);
});
(0, node_test_1.test)('hex helpers preserve the arena odd-column geometry', () => {
    strict_1.default.deepEqual((0, grid_js_1.xy)(13), { x: 1, y: 1 });
    strict_1.default.equal((0, grid_js_1.posFromXY)(1, 1), 13);
    strict_1.default.equal((0, grid_js_1.posFromXY)(-1, 1), -1);
    strict_1.default.deepEqual((0, grid_js_1.hexNeighbors)(0), [1, 12]);
    strict_1.default.deepEqual((0, grid_js_1.hexNeighbors)(13), [26, 14, 1, 12, 24, 25]);
    strict_1.default.equal((0, grid_js_1.hexDistance)(0, 13), 2);
    strict_1.default.equal((0, grid_js_1.nextStepToward)(0, 13), 1);
});
(0, node_test_1.test)('combat status timing stays deferred until activeRound', () => {
    strict_1.default.equal((0, statuses_js_1.isCombatStatusActive)({}, 1), true);
    strict_1.default.equal((0, statuses_js_1.isCombatStatusActive)({ activeRound: 1 }, 1), true);
    strict_1.default.equal((0, statuses_js_1.isCombatStatusActive)({ activeRound: 2 }, 1), false);
});
(0, node_test_1.test)('status helpers preserve add/replace/stack/tick semantics', () => {
    const oldBurn = { name: 'Burn', rounds: 1, percent: 10, kind: 'negative' };
    const newBurn = { name: 'Burn', rounds: 3, percent: 20, kind: 'negative' };
    const woundA = { name: 'Wound', rounds: 2, amount: 20, kind: 'negative' };
    const woundB = { name: 'Wound', rounds: 2, amount: 30, kind: 'negative' };
    const pending = { name: 'Shield', rounds: 2, activeRound: 3, percent: 40, kind: 'positive' };
    const durationFor = (name, fallback) => name === 'Burn' ? 2 : fallback;
    const isStackable = (name) => name === 'Wound';
    let statuses = (0, statuses_js_1.addCombatStatus)([oldBurn, pending], newBurn, { durationFor, isStackable });
    strict_1.default.deepEqual(statuses.map(status => [status.name, status.rounds, status.percent]), [['Shield', 2, 40], ['Burn', 2, 20]]);
    statuses = (0, statuses_js_1.addCombatStatus)(statuses, woundA, { durationFor, isStackable });
    statuses = (0, statuses_js_1.addCombatStatus)(statuses, woundB, { durationFor, isStackable });
    strict_1.default.equal((0, statuses_js_1.countActiveCombatStatuses)(statuses, 'Wound', 1), 2);
    strict_1.default.equal((0, statuses_js_1.hasCombatStatus)(statuses, 'Shield', 1), false);
    strict_1.default.equal((0, statuses_js_1.sumActiveCombatStatusPercent)(statuses, 'Burn', 1), 20);
    const ticked = (0, statuses_js_1.tickCombatStatuses)(statuses, 1);
    strict_1.default.deepEqual(ticked.map(status => [status.name, status.rounds]), [['Shield', 2], ['Burn', 1], ['Wound', 1], ['Wound', 1]]);
});
(0, node_test_1.test)('status cap keeps the strongest recent stacks', () => {
    const statuses = [
        { name: 'Wound', rounds: 2, amount: 10, kind: 'negative' },
        { name: 'Poison', rounds: 2, amount: 99, kind: 'negative' },
        { name: 'Wound', rounds: 2, amount: 30, kind: 'negative' },
        { name: 'Wound', rounds: 2, amount: 30, kind: 'negative' },
    ];
    const capped = (0, statuses_js_1.capCombatStatusStacks)(statuses, 'Wound', 2);
    strict_1.default.deepEqual(capped.map(status => [status.name, status.amount]), [['Poison', 99], ['Wound', 30], ['Wound', 30]]);
    strict_1.default.equal(capped.includes(statuses[3]), true, 'ties keep the most recent stack');
});
(0, node_test_1.test)('cooldown and AP helpers preserve PvP turn math', () => {
    strict_1.default.deepEqual((0, cooldowns_js_1.tickCombatCooldowns)({ ready: 1, almost: 2, long: 5 }), { almost: 1, long: 4 });
    strict_1.default.equal((0, resources_js_1.adjustedApCost)(60), 60);
    strict_1.default.equal((0, resources_js_1.adjustedApCost)(60, { lagPct: 20 }), 72);
    strict_1.default.equal((0, resources_js_1.adjustedApCost)(60, { overclockPct: 20 }), 48);
    strict_1.default.equal((0, resources_js_1.adjustedApCost)(60, { lagPct: 20, overclockPct: 20 }), 57);
    strict_1.default.equal((0, resources_js_1.adjustedApCost)(1, { overclockPct: 99 }), 1);
});
(0, node_test_1.test)('mastery fraction helper preserves the pinned ramp shape', () => {
    strict_1.default.equal((0, formulas_js_1.masteryDamageFraction)(0, 50, 0.3), 0.3);
    strict_1.default.equal((0, formulas_js_1.masteryDamageFraction)(50, 50, 0.3), 1);
    strict_1.default.equal((0, formulas_js_1.masteryDamageFraction)(25, 50, 0.3), 0.6499999999999999);
});
(0, node_test_1.test)('resolveJutsu owns phase order while phase callbacks own formulas', () => {
    const order = [];
    const self = { id: 'self', hp: 40, maxHp: 100, shield: 0 };
    const opponent = { id: 'opp', hp: 100, maxHp: 100, shield: 0 };
    const formulaSelf = { ...self, marker: 'formula-self' };
    const formulaOpponent = { ...opponent, marker: 'formula-opponent' };
    const result = (0, resolveJutsu_js_1.resolveJutsu)({
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
                strict_1.default.equal(baseSelf.marker, 'formula-self');
                strict_1.default.equal(baseOpponent.marker, 'formula-opponent');
                strict_1.default.equal(jutsu.id, 'toy');
                strict_1.default.equal(wMult, 1.25);
                strict_1.default.equal(biome, 'central');
                strict_1.default.equal(round, 4);
                strict_1.default.equal(masteryLevel, 12);
                return { baseDmg: 10, effectiveDR: 0.25, offStats: { source: 'base' } };
            },
            resolveTagStatuses: (tagSelf, tagOpponent, jutsu, round, masteryLevel, baseDmg, healBoost) => {
                order.push('status');
                strict_1.default.equal(tagSelf.marker, undefined);
                strict_1.default.equal(tagOpponent.marker, undefined);
                strict_1.default.equal(jutsu.id, 'toy');
                strict_1.default.equal(round, 4);
                strict_1.default.equal(masteryLevel, 12);
                strict_1.default.equal(baseDmg, 10);
                strict_1.default.equal(healBoost, 1);
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
                strict_1.default.equal(damageSelf.marker, undefined);
                strict_1.default.equal(damageOpponent.marker, undefined);
                strict_1.default.equal(jutsu.id, 'toy');
                strict_1.default.equal(round, 4);
                strict_1.default.equal(masteryLevel, 12);
                strict_1.default.deepEqual(offStats, { source: 'base' });
                strict_1.default.equal(damageIn, 15);
                strict_1.default.equal(pierce, false);
                strict_1.default.equal(effectiveDR, 0.25);
                return 11;
            },
            resolvePostDamage: (postSelf, postOpponent, jutsu, round, damage, pierce, healBoost) => {
                order.push('post');
                strict_1.default.equal(postSelf.marker, 'status-self');
                strict_1.default.equal(postOpponent.marker, 'status-opponent');
                strict_1.default.equal(jutsu.id, 'toy');
                strict_1.default.equal(round, 4);
                strict_1.default.equal(damage, 11);
                strict_1.default.equal(pierce, false);
                strict_1.default.equal(healBoost, 1);
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
    strict_1.default.deepEqual(order, ['base', 'status', 'damage', 'post']);
    strict_1.default.deepEqual(result.logLines, ['status line', 'post line']);
    strict_1.default.deepEqual(result.hitFx, [
        { who: 'opp', amount: 11, kind: 'damage' },
        { who: 'self', amount: 7, kind: 'heal' },
    ]);
    strict_1.default.equal(result.self.hp, 47);
    strict_1.default.equal(result.self.shield, 3);
    strict_1.default.equal(result.opponent.hp, 89);
    strict_1.default.deepEqual(result.metadata, {
        damage: 11,
        baseDamage: 10,
        effectiveDR: 0.25,
        pierce: false,
        healing: 7,
        shieldGain: 3,
        masteryLevel: 12,
    });
});
