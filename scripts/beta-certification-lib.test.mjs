import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { betaCertificationEvidencePath, REQUIRED_JOURNEY_STEPS, REQUIRED_SAFETY_CHECKS, validateBetaCertification } from './beta-certification-lib.mjs';

const valid = () => ({
  schemaVersion: 'shinobix.beta-certification.v1',
  environment: { kind: 'staging' },
  deployment: { commit: 'abcdef123456', saveStore: 'remote-proxy' },
  account: { dedicatedTestRecord: true, marker: 'beta-cert-20260714-a', cleanupStatus: 'deleted' },
  steps: REQUIRED_JOURNEY_STEPS.map((id) => ({ id, status: 'pass', ...(['first-save', 'first-reward'].includes(id) ? { requestId: `req-${id}` } : {}) })),
  safetyChecks: REQUIRED_SAFETY_CHECKS.map((id) => ({ id, status: 'pass' })),
  finalState: { saveVersion: 4, progression: {}, inventory: {}, training: {}, companion: {}, missionState: {}, position: {}, currencies: {} },
});

test('complete dedicated staging evidence passes certification', () => {
  assert.deepEqual(validateBetaCertification(valid()), []);
});

test('certification fails closed for a missing journey step, unsafe account, and missing request IDs', () => {
  const evidence = valid();
  evidence.account.dedicatedTestRecord = false;
  evidence.steps = evidence.steps.filter((step) => step.id !== 'login-again');
  delete evidence.steps.find((step) => step.id === 'first-reward').requestId;
  const errors = validateBetaCertification(evidence);
  assert.ok(errors.some((error) => error.includes('dedicatedTestRecord')));
  assert.ok(errors.some((error) => error.includes('login-again')));
  assert.ok(errors.some((error) => error.includes('first-reward requires a requestId')));
});

test('certification evidence is confined to the local evidence directory', () => {
  assert.equal(
    betaCertificationEvidencePath('beta-cert-20260715.json', '/workspace'),
    resolve('/workspace', 'release-audit', 'evidence', 'beta-cert-20260715.json'),
  );
  for (const unsafe of ['', '../secret.json', 'nested/evidence.json', 'evidence.txt', 'C:\\secret.json']) {
    assert.throws(() => betaCertificationEvidencePath(unsafe, '/workspace'), /JSON filename/i);
  }
});
