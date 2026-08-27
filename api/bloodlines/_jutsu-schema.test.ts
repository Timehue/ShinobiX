import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizePlayerBloodlineJutsus } from './_jutsu-schema.js';
import { bloodlinePoints } from '../_jutsu-points.js';
import { resolveJutsuActionPlan } from '../combat-core/resolve-jutsu-action.js';

test('player bloodline jutsu are sealed to creator-legal structural values', () => {
    const [jutsu] = normalizePlayerBloodlineJutsus([{
        id: 'crafted',
        name: 'Crafted',
        type: 'Ninjutsu',
        element: 'Blood',
        ap: 41,
        range: 30,
        effectPower: 50,
        cooldown: 0,
        chakraCost: 0,
        staminaCost: 0,
        target: 'SELF',
        method: 'AOE_BURST',
        isUtility: false,
        tags: [{ name: 'Poison', percent: 1_000_000_000 }],
        arbitraryCombatField: 123,
    }], 'B Rank');

    assert.ok(jutsu);
    assert.equal(jutsu.ap, 60);
    assert.equal(jutsu.range, 4);
    assert.equal(jutsu.effectPower, 50);
    assert.equal(jutsu.cooldown, 7);
    assert.equal(jutsu.chakraCost, 100);
    assert.equal(jutsu.staminaCost, 100);
    assert.equal(jutsu.target, 'OPPONENT');
    assert.equal(jutsu.method, 'AOE_BURST');
    assert.equal(jutsu.isUtility, false);
    assert.deepEqual(jutsu.tags, [{ name: 'Poison', percent: 30 }]);
    assert.equal('arbitraryCombatField' in jutsu, false);
});

test('AOE_BURST strips Move and remains direct, reachable, and round-trip stable', () => {
    const output = normalizePlayerBloodlineJutsus([{
        id: 'forged-moving-burst', name: 'Forged Moving Burst', type: 'Ninjutsu', element: 'Fire',
        ap: 60, range: 4, effectPower: 40, target: 'EMPTY_GROUND', method: 'AOE_BURST',
        tags: [{ name: 'Move', percent: 0 }, { name: 'Poison', percent: 30 }],
    }], 'A Rank');

    assert.equal(output.length, 1);
    assert.equal(output[0]?.method, 'AOE_BURST');
    assert.equal(output[0]?.target, 'OPPONENT');
    assert.deepEqual(output[0]?.tags, [{ name: 'Poison', percent: 30 }]);
    assert.deepEqual(normalizePlayerBloodlineJutsus(output, 'A Rank'), output);

    const sealed = output[0]!;
    const plan = resolveJutsuActionPlan({
        jutsu: {
            id: String(sealed.id),
            name: String(sealed.name),
            type: String(sealed.type),
            element: String(sealed.element),
            target: String(sealed.target),
            range: Number(sealed.range),
            ap: Number(sealed.ap),
            cooldown: Number(sealed.cooldown),
            effectPower: Number(sealed.effectPower),
            method: String(sealed.method),
            chakraCost: Number(sealed.chakraCost),
            staminaCost: Number(sealed.staminaCost),
            tags: sealed.tags,
        },
        casterPos: 0,
        opponentPos: 1,
        casterChakra: 1_000,
        casterStamina: 1_000,
        casterStatuses: [],
        round: 1,
        availableAp: 100,
        actionsThisTurn: 0,
        cooldownRemaining: 0,
        board: { width: 15, height: 15, unavailableTiles: new Set([0, 1]) },
    });
    assert.equal(plan.accepted, true);
    if (!plan.accepted) return;
    assert.equal(plan.move, false);
    assert.equal(plan.method, 'AOE_BURST');
    assert.equal(plan.hitsOpponent, true);
});

test('utility behavior and binary tag magnitudes are derived by the server', () => {
    const [jutsu] = normalizePlayerBloodlineJutsus([{
        id: 'utility', name: 'Utility', type: 'Ninjutsu', element: 'Wind',
        ap: 40, range: 30, effectPower: 50, cooldown: 0, target: 'SELF',
        method: 'SINGLE', isUtility: false,
        tags: [{ name: 'Overclock', percent: 999_999_999 }],
    }], 'S Rank');

    assert.ok(jutsu);
    assert.equal(jutsu.ap, 40);
    assert.equal(jutsu.effectPower, 0);
    assert.equal(jutsu.isUtility, true);
    assert.equal(jutsu.type, 'Any');
    assert.equal(jutsu.target, 'SELF');
    assert.equal(jutsu.range, 0);
    assert.deepEqual(jutsu.tags, [{ name: 'Overclock', percent: 0 }]);
});

test('valid maker output preserves its meaningful combat choices', () => {
    const output = normalizePlayerBloodlineJutsus([{
        id: 'valid-nuke', name: 'Valid Nuke', type: 'Genjutsu', element: 'Crystal',
        weatherElement: 'Wind', ap: 60, range: 5, effectPower: 50, cooldown: 7,
        chakraCost: 100, staminaCost: 100, target: 'OPPONENT', method: 'SINGLE',
        tags: [{ name: 'Increase Damage Taken', percent: 30 }],
    }], 'A Rank');

    assert.equal(output.length, 1);
    assert.deepEqual({
        id: output[0]!.id,
        type: output[0]!.type,
        element: output[0]!.element,
        weatherElement: output[0]!.weatherElement,
        ap: output[0]!.ap,
        range: output[0]!.range,
        effectPower: output[0]!.effectPower,
        target: output[0]!.target,
        method: output[0]!.method,
        tags: output[0]!.tags,
    }, {
        id: 'valid-nuke', type: 'Genjutsu', element: 'Crystal', weatherElement: 'Wind',
        ap: 60, range: 5, effectPower: 50, target: 'OPPONENT', method: 'SINGLE',
        tags: [{ name: 'Increase Damage Taken', percent: 30 }],
    });
});

test('bloodline-wide creator limits cap count, duplicate unique tags, and nukes', () => {
    const input = Array.from({ length: 6 }, (_, index) => ({
        id: `j-${index}`,
        name: `Jutsu ${index}`,
        type: 'Ninjutsu',
        element: 'Fire',
        ap: 60,
        range: 4,
        effectPower: 50,
        cooldown: 7,
        target: 'OPPONENT',
        method: 'SINGLE',
        tags: [{ name: 'Overclock', percent: 1_000_000 }],
    }));
    const output = normalizePlayerBloodlineJutsus(input, 'B Rank');

    assert.ok(output.length <= 4);
    assert.equal(output.filter((jutsu) => jutsu.effectPower === 50).length, 1);
    assert.equal(output.flatMap((jutsu) => jutsu.tags ?? []).filter((tag) => tag.name === 'Overclock').length, 1);
});

test('bloodline-wide offense and elemental profile cannot be mixed per jutsu', () => {
    const output = normalizePlayerBloodlineJutsus([{
        id: 'utility-first', name: 'Utility First', type: 'Any', element: 'Crystal',
        weatherElement: 'Earth', ap: 40, range: 0, effectPower: 0,
        target: 'SELF', method: 'SINGLE', tags: [{ name: 'Heal', percent: 30 }],
    }, {
        id: 'first', name: 'First', type: 'Taijutsu', element: 'Crystal',
        weatherElement: 'Earth', ap: 60, range: 4, effectPower: 40,
        target: 'OPPONENT', method: 'SINGLE', tags: [],
    }, {
        id: 'forged-mix', name: 'Mixed', type: 'Genjutsu', element: 'Blood',
        weatherElement: 'Fire', ap: 60, range: 4, effectPower: 40,
        target: 'OPPONENT', method: 'SINGLE', tags: [],
    }], 'A Rank');

    assert.equal(output.length, 3);
    assert.deepEqual(output.map((jutsu) => jutsu.type), ['Any', 'Taijutsu', 'Taijutsu']);
    assert.deepEqual(output.map((jutsu) => jutsu.element), ['Crystal', 'Crystal', 'Crystal']);
    assert.deepEqual(output.map((jutsu) => jutsu.weatherElement), ['Earth', 'Earth', 'Earth']);
});

test('unsupported low AP tiers cannot undercut the legal utility tier', () => {
    const [jutsu] = normalizePlayerBloodlineJutsus([{
        id: 'forged-ap', name: 'Forged AP', type: 'Ninjutsu', element: 'Fire',
        ap: 20, range: 30, effectPower: 50, target: 'OPPONENT', method: 'SINGLE', tags: [],
    }], 'S Rank');

    assert.ok(jutsu);
    assert.equal(jutsu.ap, 40);
    assert.equal(jutsu.effectPower, 0);
    assert.equal(jutsu.isUtility, true);
});

test('Pierce is sealed to its creator-legal 60 AP tier', () => {
    const [jutsu] = normalizePlayerBloodlineJutsus([{
        id: 'forged-pierce-ap', name: 'Forged Pierce AP', type: 'Ninjutsu', element: 'Fire',
        ap: 80, range: 4, effectPower: 40, target: 'OPPONENT', method: 'SINGLE',
        tags: [{ name: 'Pierce', percent: 0 }],
    }], 'S Rank');

    assert.ok(jutsu);
    assert.equal(jutsu.ap, 60);
    assert.equal(jutsu.effectPower, 40);
    assert.deepEqual(jutsu.tags, [{ name: 'Pierce', percent: 0 }]);
});

test('discarded invalid tags do not consume a bloodline-wide unique slot', () => {
    const output = normalizePlayerBloodlineJutsus([{
        id: 'invalid-first', name: 'Invalid First', type: 'Ninjutsu', element: 'Fire',
        ap: 40, range: 4, effectPower: 0, target: 'SELF', method: 'SINGLE',
        tags: [{ name: 'Pierce', percent: 0 }],
    }, {
        id: 'valid-pierce', name: 'Valid Pierce', type: 'Ninjutsu', element: 'Fire',
        ap: 60, range: 4, effectPower: 40, target: 'OPPONENT', method: 'SINGLE',
        tags: [{ name: 'Pierce', percent: 0 }],
    }], 'S Rank');

    assert.equal(output[0]?.tags.some((tag) => tag.name === 'Pierce'), false);
    assert.equal(output[1]?.tags.some((tag) => tag.name === 'Pierce'), true);
});

test('SINGLE Move drops every damage-required tag before point/unique accounting', () => {
    const output = normalizePlayerBloodlineJutsus([{
        id: 'forged-remote-pierce', name: 'Forged Remote Pierce', type: 'Ninjutsu', element: 'Fire',
        ap: 60, range: 4, effectPower: 40, target: 'EMPTY_GROUND', method: 'SINGLE',
        tags: [
            { name: 'Move', percent: 0 },
            { name: 'Pierce', percent: 0 },
            { name: 'Wound', percent: 35 },
            { name: 'Siphon', percent: 35 },
        ],
    }, {
        id: 'valid-pierce-after-move', name: 'Valid Pierce', type: 'Ninjutsu', element: 'Fire',
        ap: 60, range: 4, effectPower: 40, target: 'OPPONENT', method: 'SINGLE',
        tags: [{ name: 'Pierce', percent: 0 }],
    }], 'S Rank');

    assert.deepEqual(output[0]?.tags, [{ name: 'Move', percent: 0 }]);
    assert.equal(output[0]?.target, 'EMPTY_GROUND');
    assert.deepEqual(output[1]?.tags, [{ name: 'Pierce', percent: 0 }]);
});

test('over-budget SINGLE Move keeps its structural movement tag and ground target', () => {
    const output = normalizePlayerBloodlineJutsus([{
        id: 'forged-over-budget-move', name: 'Forged Over-budget Move', type: 'Ninjutsu', element: 'Fire',
        ap: 60, range: 4, effectPower: 40, target: 'EMPTY_GROUND', method: 'SINGLE',
        tags: [
            { name: 'Move', percent: 0 },
            { name: 'Copy', percent: 0 },
        ],
    }, {
        id: 'budget-mirror', name: 'Budget Mirror', type: 'Ninjutsu', element: 'Fire',
        ap: 60, range: 4, effectPower: 40, target: 'OPPONENT', method: 'SINGLE',
        tags: [{ name: 'Mirror', percent: 0 }],
    }, {
        id: 'budget-stun', name: 'Budget Stun', type: 'Ninjutsu', element: 'Fire',
        ap: 60, range: 4, effectPower: 40, target: 'OPPONENT', method: 'SINGLE',
        tags: [{ name: 'Stun', percent: 0 }],
    }, {
        id: 'budget-seal', name: 'Budget Seal', type: 'Ninjutsu', element: 'Fire',
        ap: 60, range: 4, effectPower: 40, target: 'OPPONENT', method: 'SINGLE',
        tags: [{ name: 'Bloodline Seal', percent: 0 }],
    }], 'B Rank');

    assert.equal(output.length, 4);
    assert.equal(output[0]?.target, 'EMPTY_GROUND');
    assert.equal(output[0]?.tags.some((tag) => tag.name === 'Move'), true);
    assert.ok(bloodlinePoints(output, 'B Rank') <= 7);
});

test('over-budget ground methods never seal an empty or Move-only zone', () => {
    const instantZones = Array.from({ length: 4 }, (_, index) => ({
        id: `forged-instant-${index}`, name: `Forged Instant ${index}`, type: 'Ninjutsu', element: 'Fire',
        ap: 60, range: 5, effectPower: 40, target: 'EMPTY_GROUND', method: 'INSTANT_EFFECT',
        tags: [{ name: 'Recoil', percent: 30 }],
    }));
    const spiralZones = Array.from({ length: 4 }, (_, index) => ({
        id: `forged-spiral-${index}`, name: `Forged Spiral ${index}`, type: 'Ninjutsu', element: 'Fire',
        ap: 60, range: 4, effectPower: 40, target: 'EMPTY_GROUND', method: 'AOE_SPIRAL',
        tags: [{ name: 'Poison', percent: 30 }],
    }));

    const instantOutput = normalizePlayerBloodlineJutsus(instantZones, 'B Rank');
    const spiralOutput = normalizePlayerBloodlineJutsus(spiralZones, 'B Rank');

    assert.equal(instantOutput.length, 3, 'structurally over-budget draft is truncated');
    assert.ok(instantOutput.every((jutsu) => jutsu.method === 'INSTANT_EFFECT'));
    assert.ok(instantOutput.every((jutsu) => jutsu.tags.length > 0));
    assert.ok(instantOutput.every((jutsu) => jutsu.target === 'EMPTY_GROUND'));

    assert.equal(spiralOutput.length, 3, 'structurally over-budget draft is truncated');
    assert.ok(spiralOutput.every((jutsu) => jutsu.method === 'AOE_SPIRAL'));
    assert.ok(spiralOutput.every((jutsu) => jutsu.tags.some((tag) => tag.name !== 'Move')));
    assert.ok(spiralOutput.every((jutsu) => jutsu.target === 'EMPTY_GROUND'));
});
