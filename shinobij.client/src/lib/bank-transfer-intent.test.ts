import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, test } from 'node:test';
import { pendingBankTransferIntent, readPendingBankTransferIntent } from './bank-transfer-intent';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
let sequence = 0;

beforeEach(() => {
    const entries = new Map<string, string>();
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => { entries.set(key, value); },
        removeItem: (key: string) => { entries.delete(key); },
    } });
});

afterEach(() => {
    if (originalStorage) Object.defineProperty(globalThis, 'sessionStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
});

test('an uncertain bank transfer keeps its ID across a manual retry and storage outage', () => {
    const player = `BankRetry${++sequence}`;
    assert.equal(readPendingBankTransferIntent(player, 'deposit', 300), null);
    const original = pendingBankTransferIntent(player, 'deposit', 300);
    const retry = pendingBankTransferIntent(player, 'deposit', 300);
    assert.equal(retry.requestId, original.requestId);
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('Storage unavailable'); } });
    assert.equal(pendingBankTransferIntent(player, 'deposit', 300).requestId, original.requestId);
    retry.complete();
    assert.equal(readPendingBankTransferIntent(player, 'deposit', 300), null);
});

test('a confirmed operation releases its ID; a late response cannot clear a newer intent', () => {
    const player = `BankConfirmed${++sequence}`;
    const first = pendingBankTransferIntent(player, 'withdraw', 90);
    assert.notEqual(pendingBankTransferIntent(player, 'deposit', 90).requestId, first.requestId);
    assert.notEqual(pendingBankTransferIntent(player, 'withdraw', 91).requestId, first.requestId);
    first.complete();
    const second = pendingBankTransferIntent(player, 'withdraw', 90);
    assert.notEqual(second.requestId, first.requestId);
    first.complete();
    assert.equal(readPendingBankTransferIntent(player, 'withdraw', 90)?.requestId, second.requestId);
    second.complete();
});

test('Bank sends the retained ID and allows the server to replay after its first debit', () => {
    const source = readFileSync('shinobij.client/src/screens/Bank.tsx', 'utf8');
    const move = source.slice(source.indexOf('async function moveRyo'), source.indexOf('async function claimInterest'));
    assert.match(move, /readPendingBankTransferIntent\(character\.name, direction, value\)/);
    assert.match(move, /!pending && direction === "deposit" && value > character\.ryo/);
    assert.match(move, /requestId: intent\.requestId/);
    assert.match(move, /if \(!onVersionedCharacter\([\s\S]*?\)\) return alert\(AMBIGUOUS_ACTION_MESSAGE\);\s*intent\.complete\(\)/);
});
