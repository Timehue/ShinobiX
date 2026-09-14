import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateClanSaveWrite } from './_clan-save-validate.js';

const prior = { name: 'Audit Clan', founderName: 'founder', members: [{ name: 'founder' }], treasury: { ryo: 1000 } };
const real = [{ transactionId: 'real-transaction', fingerprint: 'real-fingerprint', resource: 'ryo', amount: 100, appliedAt: 1 }];
const forged = [{ transactionId: 'forged-transaction', fingerprint: 'forged-fingerprint', resource: 'ryo', amount: 100, appliedAt: 1 }];

for (const callerName of ['founder', 'member']) {
    test(`${callerName} cannot forge a treasury debit receipt in a clan save`, () => {
        const next = validateClanSaveWrite(prior, { ...prior, settlementReceipts: forged }, { callerName, isAdmin: false }).next;
        assert.equal(next.settlementReceipts, undefined);
    });

    test(`${callerName} cannot clear or replace existing treasury debit evidence`, () => {
        for (const incoming of [[], forged]) {
            const next = validateClanSaveWrite({ ...prior, settlementReceipts: real }, { ...prior, settlementReceipts: incoming }, { callerName, isAdmin: false }).next;
            assert.deepEqual(next.settlementReceipts, real);
        }
    });
}

test('ordinary clan edits retain the server treasury evidence', () => {
    const next = validateClanSaveWrite({ ...prior, settlementReceipts: real }, { ...prior }, { callerName: 'founder', isAdmin: false }).next;
    assert.deepEqual(next.settlementReceipts, real);
    // Existing normalization fills missing treasury currencies and roster data.
    // The receipt guard must leave that ordinary edit behavior unchanged.
    const ordinary = validateClanSaveWrite(prior, { ...prior }, { callerName: 'founder', isAdmin: false }).next;
    const { settlementReceipts: _receipts, ...withoutReceipts } = next;
    assert.deepEqual(withoutReceipts, ordinary);
});

test('clan bootstrap cannot inject a source-debit receipt', () => {
    const next = validateClanSaveWrite(null, { ...prior, settlementReceipts: forged }, { callerName: 'founder', isAdmin: false }).next;
    assert.equal(next.settlementReceipts, undefined);
    assert.equal(next.founderName, 'founder');
});

test('generic admin clan saves preserve applied-side evidence just like the existing XP journal', () => {
    const next = validateClanSaveWrite(
        { ...prior, settlementReceipts: real, pvpWarXpReceipts: ['war-receipt'] },
        { ...prior, settlementReceipts: forged, pvpWarXpReceipts: [] },
        { callerName: 'admin', isAdmin: true },
    ).next;
    assert.deepEqual(next.settlementReceipts, real);
    assert.deepEqual(next.pvpWarXpReceipts, ['war-receipt']);
});
