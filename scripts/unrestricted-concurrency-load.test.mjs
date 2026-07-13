import assert from 'node:assert/strict';
import test from 'node:test';
import { MUTATION_CONFIRMATION, evaluateConcurrencyResponses, validateConcurrencyManifest, valueAtPath } from './unrestricted-concurrency-lib.mjs';

const valid = () => ({ confirmation: MUTATION_CONFIRMATION, scenarios: [{ name: 'shop-idempotency', playerName: 'load-a', token: 'secret', path: '/api/shop/settle', body: { requestId: 'same-request' }, parallel: 3, allowedStatuses: [200], mutation: { path: 'settlement.replayed', equals: false, min: 1, max: 1 } }] });

test('valueAtPath reads nested response values without throwing', () => {
    assert.equal(valueAtPath({ settlement: { replayed: false } }, 'settlement.replayed'), false);
    assert.equal(valueAtPath(null, 'settlement.replayed'), undefined);
});
test('manifest requires explicit disposable mutation confirmation', () => {
    const input = valid(); delete input.confirmation;
    assert.throws(() => validateConcurrencyManifest(input), /confirmation/);
});
test('manifest rejects absolute URLs and unsafe parallelism', () => {
    const absolute = valid(); absolute.scenarios[0].path = 'https://example.com/api/shop/settle';
    assert.throws(() => validateConcurrencyManifest(absolute), /relative/);
    const tooWide = valid(); tooWide.scenarios[0].parallel = 26;
    assert.throws(() => validateConcurrencyManifest(tooWide), /2\.\.25/);
});
test('response evaluation proves exactly one mutation and accepts replays', () => {
    const scenario = validateConcurrencyManifest(valid())[0];
    assert.deepEqual(evaluateConcurrencyResponses(scenario, [{ status: 200, body: { settlement: { replayed: false } } }, { status: 200, body: { settlement: { replayed: true } } }, { status: 200, body: { settlement: { replayed: true } } }]), { ok: true, failures: [], mutationCount: 1 });
});
test('response evaluation fails duplicate mutation and transport errors', () => {
    const scenario = validateConcurrencyManifest(valid())[0];
    const verdict = evaluateConcurrencyResponses(scenario, [{ status: 200, body: { settlement: { replayed: false } } }, { status: 200, body: { settlement: { replayed: false } } }, { transportError: 'TimeoutError' }]);
    assert.equal(verdict.ok, false);
    assert.match(verdict.failures.join(' '), /transport error/);
    assert.match(verdict.failures.join(' '), /mutation count 2/);
});
