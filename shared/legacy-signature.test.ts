import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacySignatureMasteryLevel, LEGACY_SIGNATURE_MIN_STAGE, legacySignatureShape } from './legacy-signature.js';

test('Awakening unlocks the signature and each later stage improves mastery', () => {
    assert.equal(LEGACY_SIGNATURE_MIN_STAGE, 2);
    assert.deepEqual([1, 2, 3, 4, 5].map(legacySignatureMasteryLevel), [0, 20, 30, 40, 50]);
    for (const stage of [NaN, Infinity, -1, 0, 2.5, 6]) assert.equal(legacySignatureMasteryLevel(stage), 0);
});

test('utility previews distinguish self protection from techniques requiring an opponent', () => {
    assert.equal(legacySignatureShape({ method: 'SINGLE', target: 'SELF', ap: 40 }), 'Self technique');
    assert.equal(legacySignatureShape({ method: 'SINGLE', target: 'OPPONENT', ap: 40 }), 'Opponent technique');
    assert.equal(legacySignatureShape({ method: 'AOE_CIRCLE', target: 'EMPTY_GROUND', ap: 60 }), 'Dashing strike');
});
