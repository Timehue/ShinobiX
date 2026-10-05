import assert from 'node:assert/strict';
import { test } from 'node:test';
import { offerFirstContract, readFirstContract, recordFirstContractActivity, firstContractReturnedLater } from './first-contract.js';
import { applyAcademyNarrativeAction } from '../api/player/_academy-narrative.js';

const rookie = { level: 2, onboardingStep: 'sectorReturn', academySectorVisited: true, academyFieldSeal: true, pets: [{ id: 'pet-1' }], hp: 72, ryo: 500 };
function action(character: Record<string, unknown>, next: Parameters<typeof applyAcademyNarrativeAction>[2], route?: unknown) {
    const result = applyAcademyNarrativeAction(character, {}, next, undefined, route);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) throw new Error(result.error);
    return result;
}

test('graduation and the selected route commit atomically with the Academy level floor', () => {
    const { character } = action(rookie, 'complete', 'combat');
    assert.equal(character.onboardingStep, 'done');
    assert.equal(readFirstContract(character.firstContract)?.route, 'combat');
    assert.equal(character.level, 10);
    assert.equal(character.hp, character.maxHp);
    assert.equal(character.ryo, 500);
    assert.equal(action(character, 'complete', 'discovery').changed, false);
    assert.equal(applyAcademyNarrativeAction(rookie, {}, 'complete', undefined, 'money').ok, false);
    assert.equal(applyAcademyNarrativeAction({ ...rookie, pets: [] }, {}, 'complete', undefined, 'companion').ok, false);
});

test('skip offers a recoverable journal without manufacturing Academy accomplishments', () => {
    const { character } = action({ level: 1, onboardingStep: 'training' }, 'skip');
    assert.equal(readFirstContract(character.firstContract)?.source, 'skip');
    assert.equal(character.academyFieldSeal, undefined);
    assert.equal(character.academyTrialClaimed, undefined);
    assert.equal(action(character, 'skip').changed, false);
    assert.equal(action({ level: 30, onboardingStep: 'training' }, 'skip').character.firstContract, undefined);
    assert.equal(action({ level: 2, onboardingStep: 'done' }, 'skip').character.firstContract, undefined);
});

test('assignments unlock in order and unrelated activity cannot finish the active assignment', () => {
    const { character } = action(rookie, 'complete', 'combat');
    assert.equal(applyAcademyNarrativeAction(character, {}, 'discovery').ok, false, 'step two stays locked until combat is completed');
    assert.equal(recordFirstContractActivity(character, 'discovery', { kind: 'field-explore', sector: 4 }), character);
    const combat = recordFirstContractActivity(character, 'combat', { kind: 'combat-claim' });
    assert.deepEqual(readFirstContract(combat.firstContract)?.completedRoutes, ['combat']);
    const discovery = action(combat, 'discovery').character;
    assert.equal(readFirstContract(discovery.firstContract)?.completedAt, undefined);
    const finished = recordFirstContractActivity(discovery, 'discovery', { kind: 'field-explore', sector: 4 });
    assert.equal(readFirstContract(finished.firstContract)?.evidence?.sector, 4);
    assert.deepEqual(readFirstContract(finished.firstContract)?.completedRoutes, ['combat', 'discovery']);
    assert.equal(recordFirstContractActivity(finished, 'discovery', { kind: 'field-explore', sector: 9 }), finished);
    assert.equal(applyAcademyNarrativeAction(finished, {}, 'companion').ok, true, 'the third assignment unlocks after discovery');
    assert.equal(applyAcademyNarrativeAction(finished, {}, 'combat').ok, false, 'completed steps cannot be selected again');
});

test('completion acknowledgements and next-day return are durable and replay-safe', () => {
    assert.equal(applyAcademyNarrativeAction(rookie, {}, 'complete', undefined, 'companion').ok, false, 'graduation must start at the first assignment');
    const { character } = action(rookie, 'complete', 'combat');
    assert.equal(applyAcademyNarrativeAction(character, {}, 'contract-acknowledge').ok, false);
    const first = recordFirstContractActivity(character, 'combat', { kind: 'combat-claim' }, Date.now() - 86_400_000);
    assert.equal(applyAcademyNarrativeAction(first, {}, 'contract-acknowledge').ok, false, 'the journal remains open until all steps are complete');
    const discovery = action(first, 'discovery').character;
    const second = recordFirstContractActivity(discovery, 'discovery', { kind: 'field-explore', sector: 4 }, Date.now() - 86_400_000);
    const companion = action(second, 'companion').character;
    const completed = recordFirstContractActivity(companion, 'companion', { kind: 'companion-care' }, Date.now() - 86_400_000);
    assert.deepEqual(readFirstContract(completed.firstContract)?.completedRoutes, ['combat', 'discovery', 'companion']);
    const acknowledged = action(completed, 'contract-acknowledge').character;
    assert.equal(action(acknowledged, 'contract-acknowledge').changed, false);
    const returned = action(acknowledged, 'contract-return').character;
    assert.equal(action(returned, 'contract-return').changed, false);
    assert.ok(readFirstContract(returned.firstContract)?.returnedAt);
    const today = recordFirstContractActivity(companion, 'companion', { kind: 'companion-care' });
    assert.equal(action(today, 'contract-return').changed, false);
});

test('offers are idempotent and days are explicitly UTC, not an invented retention measure', () => {
    const original = offerFirstContract<Record<string, unknown>>({ level: 1 }, 'academy', 86_400_001);
    assert.equal(offerFirstContract(original, 'skip'), original);
    const state = readFirstContract(original.firstContract)!;
    assert.equal(firstContractReturnedLater(state, 300_000_000), false);
    assert.equal(firstContractReturnedLater({ ...state, completedAt: 86_400_001 }, 172_799_999), false);
    assert.equal(firstContractReturnedLater({ ...state, completedAt: 86_400_001 }, 172_800_000), true);
});
