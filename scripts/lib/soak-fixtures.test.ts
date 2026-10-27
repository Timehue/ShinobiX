import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as moderation from '../../api/_text-moderation.js';
import { createSoakName, setupFailureDiagnostic } from './soak-fixtures.mjs';

test('soak names reject generated candidates forbidden by the real server rules', () => {
    const suffixes = ['717500', 'abcdef'];
    assert.equal(moderation.isCleanPlayerName('soak7175000'), false);
    let attempts = 0;
    const name = createSoakName(0, moderation, () => suffixes[attempts++]);
    assert.equal(name, 'soakabcdef0');
    assert.equal(attempts, 2);
});

test('soak name rejection has a bounded failure instead of an endless loop', () => {
    let attempts = 0;
    assert.throws(() => createSoakName(0, moderation, () => {
        attempts += 1;
        return '717500';
    }), /after 64 candidates/);
    assert.equal(attempts, 64);
});

test('setup diagnostics retain phase and HTTP status without disclosing auth data', () => {
    const diagnostic = setupFailureDiagnostic({
        player: 7, phase: 'initial-save', attempt: 2, status: 409, reason: 'rejected',
        name: 'private-name', password: 'private-password', token: 'private-token',
        body: { token: 'private-response-token' }, error: new Error('private-error-message'),
    });
    assert.match(diagnostic, /player=7 phase=initial-save attempt=2 status=409 reason=rejected/);
    assert.doesNotMatch(diagnostic, /private|password|token|body/);
});

test('setup diagnostics distinguish missing tokens and transport exceptions using fixed labels', () => {
    assert.match(setupFailureDiagnostic({ player: 0, phase: 'register', attempt: 1, status: 200, reason: 'missing-token' }), /status=200 reason=missing-token/);
    assert.match(setupFailureDiagnostic({ player: 0, phase: 'initial-save', attempt: 1, status: null, reason: 'exception' }), /phase=initial-save attempt=1 status=none reason=exception/);
    const diagnostic = setupFailureDiagnostic({ player: 'private-token', phase: 'private-token', attempt: 'private-token', status: 'private-token', reason: 'private-token' });
    assert.doesNotMatch(diagnostic, /private-token/);
});
