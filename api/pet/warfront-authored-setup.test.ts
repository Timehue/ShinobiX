import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStartAuthoredSetup, sealedWarfrontCoachRounds, WARFRONT_COUNCIL_ROUNDS, warfrontAiTacticalSetup } from './warfront-start.js';
import { DEFAULT_WARFRONT_AUTHORED_SETUP } from './_warfront-setup.js';

test('Auto requires both one-shot declarations while Coach can defer them', () => {
    const deferred = {
        deployment: DEFAULT_WARFRONT_AUTHORED_SETUP.deployment,
        buildPackage: 'hold-line',
        coachOrder: 'contest',
    };
    assert.equal(parseStartAuthoredSetup(deferred, 'balanced'), null, 'Auto cannot reveal the seed before sealing its full playbook');
    assert.deepEqual(parseStartAuthoredSetup(deferred, 'off'), deferred,
        'Coach keeps objective and counterstrike absent so their live selectors remain reachable');
    assert.equal(parseStartAuthoredSetup({ ...deferred, objectiveTechnique: null, counterstrike: null }, 'off'), null,
        'explicit malformed/null values are not silently coerced');

    const complete = { ...deferred, objectiveTechnique: 'zone', counterstrike: 'fortify' };
    assert.deepEqual(parseStartAuthoredSetup(complete, 'balanced'), complete);
    assert.deepEqual(parseStartAuthoredSetup(complete, 'off'), complete,
        'Coach may intentionally precommit either one-shot declaration');
});

test('sealed Auto coach order is repeated at every real Council boundary', () => {
    const rounds = sealedWarfrontCoachRounds('ambush');
    assert.equal(rounds.length, WARFRONT_COUNCIL_ROUNDS);
    assert.ok(rounds.length > 0);
    assert.ok(rounds.every((entry) => entry.coachOrder === 'ambush'));
    assert.equal(new Set(rounds).size, rounds.length, 'each immutable round entry must be a distinct object');
});

test('AI warband plans are deterministic, complete, and profile-readable', () => {
    assert.deepEqual(
        [0, 1, 2].map((seed) => warfrontAiTacticalSetup(seed)),
        [0, 1, 2].map((seed) => warfrontAiTacticalSetup(seed)),
    );
    const packages = new Set([0, 1, 2].map((seed) => warfrontAiTacticalSetup(seed).buildPackage));
    assert.deepEqual(packages, new Set(['escort-rite', 'hold-line', 'blood-hunt']));
    for (const seed of [0, 1, 2]) {
        const setup = warfrontAiTacticalSetup(seed);
        assert.ok(setup.objectiveTechnique);
        assert.ok(setup.counterstrike);
    }
});
