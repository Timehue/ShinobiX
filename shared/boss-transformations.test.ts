import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyMovesetDelta,
    attackMatchesWeakness,
    bossChargeTurn,
    bossFormDamageMult,
    bossFormDamageTakenMult,
    bossFormView,
    bossLimitBurn,
    bossSelfBurn,
    checkBossChargeBreak,
    createBossTransformationState,
    enterBossForms,
    validateBossTransformationPlan,
    type BossTransformationPlan,
} from './boss-transformations.js';

const plan: BossTransformationPlan = {
    id: 'test-boss',
    phases: [
        {
            id: 'second', atHpPct: 66, formName: 'Second Form', aura: 'storm', summary: 'It hits harder.',
            cutscene: { speaker: 'Boss', lines: ['Again.'] }, damageMult: 1.2, healPct: 10,
            moveset: { remove: ['a'], add: ['b'] },
            mechanic: { kind: 'charged-strike', name: 'Big Bolt', damagePct: 20, breakPct: 10, everyRounds: 3, tell: 'Break it.' },
        },
        {
            id: 'third', atHpPct: 33, formName: 'Third Form', aura: 'flame', summary: 'It guards.',
            cutscene: { speaker: 'Boss', lines: ['Last time.'] }, damageTakenMult: 0.7, healPct: 25,
            moveset: { remove: ['b'], add: ['c'], favor: ['c'] },
            mechanic: { kind: 'guard-stance', name: 'Shell', weakness: 'Water', weaknessMult: 1.3, tell: 'Use Water.' },
        },
    ],
};

/** A save/load cycle: exactly what a refresh does to the persisted session. */
const reload = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('boss transformations', () => {
    it('enters a form once when its threshold is crossed, healing and recording it', () => {
        const state = createBossTransformationState(plan);
        assert.equal(enterBossForms(state, { name: 'Boss', hp: 700, maxHp: 1000 }, 1), null, '70% crosses nothing');
        const effects = enterBossForms(state, { name: 'Boss', hp: 650, maxHp: 1000 }, 2)!;
        assert.equal(effects.landing.id, 'second');
        assert.equal(effects.hp, 750, 'a 10% heal on entry');
        assert.deepEqual(state.triggered, ['second']);
        assert.equal(state.phase, 1);
        assert.equal(state.seq, 1);
        assert.equal(bossFormDamageMult(state), 1.2);
        // The healed boss sits back above 66%: falling below it again does nothing.
        assert.equal(enterBossForms(state, { name: 'Boss', hp: 600, maxHp: 1000 }, 3), null);
    });

    it('never fires a form twice, even after the session is saved and reloaded', () => {
        let state = createBossTransformationState(plan);
        assert.ok(enterBossForms(state, { name: 'Boss', hp: 600, maxHp: 1000 }, 1));
        state = reload(state);
        for (let round = 2; round < 6; round++) assert.equal(enterBossForms(state, { name: 'Boss', hp: 600, maxHp: 1000 }, round), null);
        assert.equal(state.seq, 1);
    });

    it('lands in the deepest form when one hit crosses several thresholds', () => {
        const state = createBossTransformationState(plan);
        const effects = enterBossForms(state, { name: 'Boss', hp: 200, maxHp: 1000 }, 4)!;
        assert.equal(effects.landing.id, 'third');
        assert.deepEqual(effects.skipped.map(phase => phase.id), ['second']);
        assert.deepEqual(state.triggered, ['second', 'third'], 'both forms are spent');
        assert.equal(state.phase, 2);
        assert.equal(state.seq, 1, 'one cut-scene');
        assert.equal(effects.hp, 450, "only the landing form's heal applies");
        // Movesets are cumulative, so the kit does not depend on how hard the boss was hit.
        assert.deepEqual(applyMovesetDelta(['a', 'x'], effects.learned, effects.forgotten), ['x', 'c']);
        assert.equal(bossFormDamageMult(state), 1, "the second form's stats were superseded");
        assert.match(effects.log.join(' '), /Second Form/);
        assert.deepEqual(bossFormView(state, 4)?.skipped, ['Second Form']);
    });

    it('a lethal blow with a form pending leaves the boss at 1 HP and transforms it', () => {
        const state = createBossTransformationState(plan);
        const effects = enterBossForms(state, { name: 'Boss', hp: -50, maxHp: 1000 }, 2)!;
        assert.equal(effects.record.savedFromLethal, true);
        assert.equal(effects.landing.id, 'third');
        assert.equal(effects.hp, 251, '1 HP plus the landing heal');
        assert.equal(enterBossForms(state, { name: 'Boss', hp: 0, maxHp: 1000 }, 3), null, 'once spent, the next lethal blow wins');
    });

    it('a plan can opt out of the lethal guard', () => {
        const state = createBossTransformationState({ ...plan, lethalGuard: false });
        assert.equal(enterBossForms(state, { name: 'Boss', hp: 0, maxHp: 1000 }, 2), null);
        assert.deepEqual(state.triggered, []);
    });

    it('a guard stance resists attacks except its weakness', () => {
        const state = createBossTransformationState(plan);
        enterBossForms(state, { name: 'Boss', hp: 300, maxHp: 1000 }, 1);
        assert.equal(bossFormDamageTakenMult(state, 1, { element: 'Fire', type: 'Ninjutsu' }), 0.7);
        assert.equal(bossFormDamageTakenMult(state, 1, { element: 'water', type: 'Ninjutsu' }), 1.3);
        assert.equal(bossFormDamageTakenMult(createBossTransformationState(plan), 1, { element: 'Water' }), 1, 'the base form has no stance');
        assert.equal(attackMatchesWeakness(['Taijutsu', 'Earth'], { type: 'taijutsu', element: 'Fire' }), true, 'a list matches a jutsu type');
        assert.equal(attackMatchesWeakness(['Taijutsu', 'Earth'], { type: 'Ninjutsu', element: 'Earth' }), true, 'or an element');
        assert.equal(attackMatchesWeakness(['Taijutsu', 'Earth'], { type: 'Ninjutsu', element: 'Fire' }), false);
        assert.equal(attackMatchesWeakness([], { type: 'Ninjutsu' }), false);
    });

    it('a charge arms, detonates on the next boss turn, and breaks to damage or a stun', () => {
        const state = createBossTransformationState(plan);
        enterBossForms(state, { name: 'Boss', hp: 600, maxHp: 1000 }, 1);
        assert.equal(bossChargeTurn(state, { hp: 600, maxHp: 1000 }, 1), null, 'no charge on the round it transformed');
        const armed = bossChargeTurn(state, { hp: 600, maxHp: 1000 }, 2);
        assert.equal(armed?.kind, 'armed');
        assert.equal(state.charge?.breakAt, 100);
        assert.equal(bossChargeTurn(state, { hp: 600, maxHp: 1000 }, 2), null, 'same turn: nothing new');
        assert.equal(checkBossChargeBreak(state, { hp: 560 }, 2), undefined, '40 damage is not enough');
        const detonate = bossChargeTurn(reload(state), { hp: 560, maxHp: 1000 }, 3);
        assert.equal(detonate?.kind, 'detonate');
        assert.equal(detonate?.kind === 'detonate' && detonate.damagePct, 20);

        assert.ok(checkBossChargeBreak(state, { hp: 500 }, 2), '100 damage breaks it');
        assert.equal(state.charge, undefined);
        assert.equal(bossFormDamageTakenMult(state, 3), 1.25, 'staggered through the next round');
        assert.equal(bossFormDamageTakenMult(state, 4), 1);
        assert.equal(bossChargeTurn(state, { hp: 500, maxHp: 1000 }, 4), null, 'cadence: not before round 5');
        assert.equal(bossChargeTurn(state, { hp: 500, maxHp: 1000 }, 5)?.kind, 'armed');
        assert.ok(checkBossChargeBreak(state, { hp: 500 }, 5, true), 'a stun breaks it');
    });

    it('a limit burn costs a share of max HP but never kills', () => {
        const state = createBossTransformationState({
            id: 'burn', phases: [{
                id: 'gate', atHpPct: 50, formName: 'Gate', aura: 'steam', summary: 'Burns.',
                cutscene: { speaker: 'Boss', lines: ['Open.'] },
                mechanic: { kind: 'limit-burn', name: 'Burn', burnPct: 3, tell: 'It burns.' },
            }],
        });
        assert.equal(bossLimitBurn(state, { hp: 400, maxHp: 1000 }), 0, 'base form');
        enterBossForms(state, { name: 'Boss', hp: 400, maxHp: 1000 }, 1);
        assert.equal(bossLimitBurn(state, { hp: 400, maxHp: 1000 }), 30);
        assert.equal(bossLimitBurn(state, { hp: 10, maxHp: 1000 }), 9);
        assert.equal(bossLimitBurn(state, { hp: 1, maxHp: 1000 }), 0);
    });

    it("a boss's own burn never counts toward breaking its charge", () => {
        const state = createBossTransformationState({ ...plan, phases: [{ ...plan.phases[0]!, upkeepPct: 6 }] });
        enterBossForms(state, { name: 'Boss', hp: 600, maxHp: 1000 }, 1);
        bossChargeTurn(state, { hp: 600, maxHp: 1000 }, 2);
        assert.equal(state.charge?.breakAt, 100);
        const burn = bossSelfBurn(state, { hp: 600, maxHp: 1000 });
        assert.equal(burn, 60);
        assert.equal(checkBossChargeBreak(state, { hp: 540 }, 2), undefined, 'the burn alone does not break it');
        assert.equal(checkBossChargeBreak(state, { hp: 460 }, 2), undefined, '80 dealt by the player is not enough');
        assert.ok(checkBossChargeBreak(state, { hp: 440 }, 2), '100 dealt by the player breaks it');
    });

    it('a form upkeep costs health every turn on top of its mechanic, within the ceiling', () => {
        const upkeep = createBossTransformationState({ ...plan, phases: [{ ...plan.phases[0]!, upkeepPct: 4 }] });
        enterBossForms(upkeep, { name: 'Boss', hp: 600, maxHp: 1000 }, 1);
        assert.equal(bossLimitBurn(upkeep, { hp: 600, maxHp: 1000 }), 40, 'a charging form can still pay upkeep');
        const both = createBossTransformationState({ id: 'both', phases: [{
            id: 'gate', atHpPct: 50, formName: 'Gate', aura: 'steam', summary: 'Burns.', upkeepPct: 6,
            cutscene: { speaker: 'Boss', lines: ['Open.'] },
            mechanic: { kind: 'limit-burn', name: 'Burn', burnPct: 6, tell: 'It burns.' },
        }] });
        enterBossForms(both, { name: 'Boss', hp: 400, maxHp: 1000 }, 1);
        assert.equal(bossLimitBurn(both, { hp: 400, maxHp: 1000 }), 80, 'capped at 8% per turn');
    });

    it('validates authored plans', () => {
        assert.deepEqual(validateBossTransformationPlan(plan), []);
        const bad: BossTransformationPlan = { id: 'bad', phases: [
            { ...plan.phases[1]!, id: 'x', atHpPct: 30 },
            { ...plan.phases[0]!, id: 'x', atHpPct: 60, damageMult: 9 },
        ] };
        const problems = validateBossTransformationPlan(bad).join('\n');
        assert.match(problems, /duplicate form id/);
        assert.match(problems, /strictly descend/);
        assert.match(problems, /damageMult out of range/);
        const summon: BossTransformationPlan = { id: 's', phases: [{ ...plan.phases[0]!, mechanic: { kind: 'summon', name: 'Call', aiId: 'grunt', count: 2, tell: 'Adds.' } }] };
        assert.match(validateBossTransformationPlan(summon).join(), /board engine/);
        assert.deepEqual(validateBossTransformationPlan(summon, { allowSummon: true }), []);
    });
});
