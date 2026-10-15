import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLegacyAuthRecord } from './wrap-legacy-password-hashes.mjs';

test('only bare legacy HMAC rows are selected for wrapping', () => {
    assert.equal(isLegacyAuthRecord({ hash: 'a'.repeat(64), salt: 's' }), true);
    assert.equal(isLegacyAuthRecord({ hash: `scrypt:32768:8:1:${'a'.repeat(128)}`, salt: 's' }), false);
    assert.equal(isLegacyAuthRecord({ hash: `scrypt-hmac:32768:8:1:${'a'.repeat(128)}`, salt: 's' }), false, 'never wrapped twice');
    assert.equal(isLegacyAuthRecord({ google: { sub: 'x' } }), false, 'passwordless rows are left alone');
    assert.equal(isLegacyAuthRecord(null), false);
});
