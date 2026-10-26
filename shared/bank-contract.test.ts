import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiErrorContract } from './api-contract.js';
import { bankTransferRequestContract as request, bankTransferResponseContract as response, bankInterestResponseContract as interest } from './bank-contract.js';

const valid = {
    ok: true, action: 'deposit', amount: 300, ryo: 700, bankRyo: 300,
    character: { name: 'ninja', ryo: 700, bankRyo: 300, futureField: { keep: true } }, _saveVersion: 2,
};

test('legacy direction, null request ID, and action precedence remain compatible', () => {
    assert.deepEqual(request.parse({ playerName: 'Ninja', direction: 'deposit', amount: 3, requestId: null, future: 1 }),
        { playerName: 'Ninja', action: 'deposit', amount: 3 });
    assert.equal(request.parse({ playerName: 'Ninja', action: 'withdraw', direction: 'deposit', amount: 3 }).action, 'withdraw');
    assert.equal(request.parse({ playerName: 'Ninja', action: 'deposit', amount: 3, requestId: '  op-00000000000001  ' }).requestId, 'op-00000000000001');
});

test('malformed requests fail closed without coercing money', () => {
    for (const amount of [0, -1, 1.5, 10_000_001, NaN, Infinity, '3', true, {}, []]) {
        assert.equal(request.safeParse({ playerName: 'Ninja', action: 'deposit', amount }).success, false);
    }
    for (const value of [null, [], 1, true, { playerName: {} }, { playerName: ' ' }, { playerName: 'Ninja', action: 'mint', amount: 1 }]) {
        assert.equal(request.safeParse(value).success, false);
    }
    assert.equal(request.safeParse({ playerName: 'Ninja', action: 'deposit', amount: 1, requestId: 'short' }).success, false);
});

test('bank response requires an acknowledgement, version and numeric authoritative balances', () => {
    for (const changes of [{ ok: false }, { ok: undefined }, { _saveVersion: '2' }, { _saveVersion: 0 },
        { amount: -1 }, { action: 'mint' }, { character: [] }, { replayed: 'yes' },
        { character: { name: 'ninja', ryo: '700', bankRyo: 300 } }, { villageTax: { applied: true } }]) {
        assert.equal(response.safeParse({ ...valid, ...changes }).success, false, JSON.stringify(changes));
    }
    assert.deepEqual(response.parse(valid).character.futureField, { keep: true }, 'unknown save fields are never stripped');
});

test('replay receipt balances can differ from the current authoritative save', () => {
    const parsed = response.parse({ ...valid, replayed: true, _saveVersion: 7, character: { ...valid.character, ryo: 400, bankRyo: 600 } });
    assert.equal(parsed.ryo, 700);
    assert.equal(parsed.character.ryo, 400);
    assert.equal(parsed._saveVersion, 7);
});

test('interest separates an uncredited refusal from a credited claim', () => {
    const base = { ok: true, nextClaimAt: 100_000, _saveVersion: 3 };
    assert.equal(interest.parse({ ...base, eligible: false, claimed: 0, reason: 'cooldown' }).eligible, false);
    assert.equal(interest.parse({ ...base, eligible: true, claimed: 5, bankRyo: 1005, lastBankInterestAt: 10 }).eligible, true);
    for (const fields of [{ eligible: false, claimed: 5, reason: 'cooldown' }, { eligible: false, claimed: 0, reason: 'oops' },
        { eligible: true, claimed: 0, bankRyo: 1000, lastBankInterestAt: 10 }, { eligible: true, claimed: 5 }]) {
        assert.equal(interest.safeParse({ ...base, ...fields }).success, false);
    }
});

test('errors validate the message and optional authoritative tax echo', () => {
    const error = { error: 'Not enough ryo.', villageTax: { applied: true, taxed: 10, toBurn: 5, toTreasury: 5, ryo: 90, bankRyo: 0, _saveVersion: 2 } };
    assert.deepEqual(apiErrorContract.parse(error), error);
    for (const value of [{}, { error: {} }, { error: 'failed', ok: true }, { ...error, villageTax: { ...error.villageTax, ryo: '90' } }]) {
        assert.equal(apiErrorContract.safeParse(value).success, false);
    }
});
