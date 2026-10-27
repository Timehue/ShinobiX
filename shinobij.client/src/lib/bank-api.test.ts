import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transferBankRyo, claimBankInterest, bankTransferRefused, readBankAuthority, readBankSave } from './bank-api';
import { validatedSaveVersionEventDetail } from '../authFetch';

const valid = { ok: true, action: 'deposit', amount: 300, ryo: 700, bankRyo: 300, character: { name: 'Ninja', ryo: 700, bankRyo: 300 }, _saveVersion: 2 };
const requestId = 'bank-op-000000000001';

test('malformed banking replies cannot advance save authority through the fetch observer', async () => {
    for (const path of ['/api/bank/transfer', '/api/bank/claim-interest', '/api/player/trade']) {
        assert.equal(await validatedSaveVersionEventDetail({ _saveVersion: 999 }, 'Ninja', 'mutation', path), null);
    }
    const interest = { ok: true, eligible: false, claimed: 0, reason: 'cooldown', nextClaimAt: 1000, _saveVersion: 2 };
    assert.equal(await validatedSaveVersionEventDetail(interest, 'Ninja', 'mutation', '/api/bank/claim-interest'), null,
        'even valid receipts cannot advance the version before their caller adopts the character');
});

test('interest snapshots retain the whole character and version without another read', async t => {
    const receipt = { ok: true as const, eligible: false as const, claimed: 0 as const, reason: 'cooldown' as const,
        nextClaimAt: 1000, _saveVersion: 5, character: { name: 'Ninja', bankRyo: 200, futureField: ['keep'] } };
    t.mock.method(globalThis, 'fetch', async () => Response.json(receipt));
    const reply = await claimBankInterest('Ninja');
    assert.deepEqual(reply.data, receipt);
    const read = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected read'); });
    assert.deepEqual(await readBankAuthority('Ninja', reply.data!), { character: receipt.character, _saveVersion: 5 });
    assert.equal(read.mock.callCount(), 0);
    await assert.rejects(readBankAuthority('Another', receipt), /another account/);
});

test('legacy interest receipts recover a whole current own-save, never a partial balance patch', async t => {
    const receipt = { ok: true as const, eligible: false as const, claimed: 0 as const, reason: 'cooldown' as const, nextClaimAt: 1000, _saveVersion: 5 };
    const current = { character: { name: 'Ninja', ryo: 12, bankRyo: 300, futureField: 'preserved' }, _saveVersion: 7 };
    t.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
        assert.equal(url, '/api/save/ninja'); assert.equal(init.cache, 'no-store'); return Response.json(current);
    });
    assert.deepEqual(await readBankAuthority('Ninja', receipt), current);
    t.mock.restoreAll();
    for (const invalid of [{ ...current, _saveVersion: 4 }, { ...current, character: { name: 'Other' } },
        { ...current, character: { name: 'Ninja', bankRyo: '300' } }, { ...current, _saveVersion: '7' }]) {
        t.mock.method(globalThis, 'fetch', async () => Response.json(invalid));
        await assert.rejects(readBankAuthority('Ninja', receipt)); t.mock.restoreAll();
    }
    t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
    await assert.rejects(readBankSave('Ninja'), /refresh/);
});

test('interest rejects another account snapshot even with a valid receipt', async t => {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: true, eligible: false, claimed: 0,
        reason: 'cooldown', nextClaimAt: 1000, _saveVersion: 5, character: { name: 'Other' } }));
    assert.equal((await claimBankInterest('Ninja')).data, null);
});

test('valid transfer echoes and replay versions reach the coordinator unchanged', async t => {
    const sent: unknown[] = [];
    t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)));
        return Response.json({ ...valid, replayed: true, character: { ...valid.character, ryo: 400 }, _saveVersion: 1 });
    });
    const reply = await transferBankRyo('Ninja', 'deposit', 300, requestId);
    assert.equal(reply.data?._saveVersion, 1, 'a stale acknowledgement still confirms the operation; the coordinator owns ordering');
    assert.equal(reply.data?.character.ryo, 400);
    assert.deepEqual(sent, [{ playerName: 'Ninja', action: 'deposit', direction: 'deposit', amount: 300, requestId }]);
});

test('malformed JSON, partial successes and acknowledgements of another operation stay uncertain', async t => {
    for (const value of [null, [], {}, { character: valid.character }, { ...valid, amount: 301 }, { ...valid, action: 'withdraw' },
        { ...valid, _saveVersion: '2' }, { ...valid, character: { ...valid.character, name: 'someone-else' } }]) {
        t.mock.method(globalThis, 'fetch', async () => Response.json(value));
        const reply = await transferBankRyo('Ninja', 'deposit', 300, requestId);
        assert.equal(reply.data, null);
        assert.equal(bankTransferRefused(reply), false);
        t.mock.restoreAll();
    }
    t.mock.method(globalThis, 'fetch', async () => new Response('<html>gateway</html>'));
    assert.equal((await transferBankRyo('Ninja', 'deposit', 300, requestId)).data, null);
});

test('only validated definitive refusals can release an intent', async t => {
    for (const status of [400, 401, 403, 408, 409, 422, 429, 500, 503]) {
        t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Rejected.' }, { status }));
        assert.equal(bankTransferRefused(await transferBankRyo('Ninja', 'deposit', 300, requestId)), [400, 409, 422].includes(status));
        t.mock.restoreAll();
        t.mock.method(globalThis, 'fetch', async () => Response.json({ error: {} }, { status }));
        assert.equal(bankTransferRefused(await transferBankRyo('Ninja', 'deposit', 300, requestId)), false);
        t.mock.restoreAll();
    }
});

test('request validation happens before any financial request is sent', async t => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(valid));
    await assert.rejects(transferBankRyo('Ninja', 'deposit', NaN, requestId), /whole number/);
    assert.equal(fetch.mock.callCount(), 0);
});

test('interest rejects incomplete credits and retains the server refusal reason', async t => {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: true, eligible: true, claimed: 50 }));
    assert.equal((await claimBankInterest('Ninja')).data, null);
    t.mock.restoreAll();
    t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: true, eligible: false, claimed: 0, reason: 'cooldown', nextClaimAt: 1000, _saveVersion: 5 }));
    assert.deepEqual((await claimBankInterest('Ninja')).data, { ok: true, eligible: false, claimed: 0, reason: 'cooldown', nextClaimAt: 1000, _saveVersion: 5 });
});
