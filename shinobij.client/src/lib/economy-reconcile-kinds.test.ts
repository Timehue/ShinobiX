import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { canReconcileEconomyTx, RECONCILABLE_SAGA_KINDS } from './economy-reconcile-kinds';

test('the admin view offers Reconcile for exactly the saga kinds the server registers', () => {
    // Read, not imported: importing the server module would open its storage.
    const kinds = readFileSync('api/_save-debit-kinds.ts', 'utf8');
    const declared = [...kinds.matchAll(/^\s+kind: '([a-z0-9-]+)',$/gm)].map((match) => match[1]).sort();
    const registered = [...kinds.matchAll(/^\s+\[([A-Z_]+)\.kind\]:/gm)].length;
    assert.equal(registered, declared.length, 'every saga kind defined there is registered in SAVE_DEBIT_SAGAS');
    assert.deepEqual([...RECONCILABLE_SAGA_KINDS].sort(), declared);
});

test('a saga journal is reconcilable until it finishes; other kinds only when they need it', () => {
    assert.equal(canReconcileEconomyTx({ state: 'debit-applied', kind: 'village-tax', resource: 'ryo' }), true);
    assert.equal(canReconcileEconomyTx({ state: 'reserved', kind: 'clan-war-declare', resource: 'honorSeals' }), true);
    assert.equal(canReconcileEconomyTx({ state: 'complete', kind: 'village-tax', resource: 'ryo' }), false);
    assert.equal(canReconcileEconomyTx({ state: 'needs-reconcile', kind: 'kage-challenge-declare', resource: 'ryo' }), true);
    assert.equal(canReconcileEconomyTx({ state: 'needs-reconcile', kind: 'kage-challenge-declare', resource: 'honorSeals' }), false);
    assert.equal(canReconcileEconomyTx({ state: 'debit-applied', kind: 'hollow-gate-unlock', resource: 'honorSeals' }), false);
    assert.equal(canReconcileEconomyTx({ state: 'needs-reconcile', kind: 'clan-territory-collect-supply', resource: 'warSupply' }), true);
    assert.equal(canReconcileEconomyTx({ state: 'needs-reconcile', kind: 'player-trade', resource: 'ryo' }), false);
});
