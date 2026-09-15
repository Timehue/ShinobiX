import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HG_CLAWBACK_KEYS } from './_run-token.js';
import { recordHollowGateExternalCredits, hollowGateExternalCredits, hollowGateProtectedCurrencyBaseline } from './_external-credits.js';
import { reconcileLedgerAmount } from './_ledger.js';
import { versionedPlayerRecord, writeVersionedPlayerSaveWithStore } from '../save/_mutate-player-save.js';
import { mergePreservingImages } from '../_utils.js';
import { enforceRawSaveLedgerBoundary } from '../save/_sanitize-ledger.js';
import { buildRestoredSave } from '../admin/save-snapshot.js';

type Character = Record<string, unknown>;
const wallet = (amount: number): Character => Object.fromEntries(HG_CLAWBACK_KEYS.map(key => [key, amount]));
const active = (amount = 1200): Character => ({ ...wallet(amount), hollowGateRun: { runToken: 'run-a' } });
const characterOf = (record: Record<string, unknown>) => record.character as Character;

test('all seven currencies preserve trusted external credits at every death retention and exclude unexplained inflation', () => {
    const before = active();
    const credited = characterOf(versionedPlayerRecord({ character: before }, { ...before, ...wallet(1290) }).record);
    for (const key of HG_CLAWBACK_KEYS) {
        assert.equal(hollowGateExternalCredits(credited, 'run-a')[key], 90);
        const baseline = hollowGateProtectedCurrencyBaseline(credited, 'run-a', key, 1000);
        for (const retention of [0.5, 0.6, 0.7, 0.8, 1]) {
            assert.equal(reconcileLedgerAmount(1290, baseline, 200, retention), 1090 + Math.floor(200 * retention));
            assert.equal(reconcileLedgerAmount(1_000_000, baseline, 200, retention), 1090 + Math.floor(200 * retention));
            assert.equal(reconcileLedgerAmount(1040, baseline, 200, retention), 1040, 'spent funds are never recreated');
        }
    }
    assert.deepEqual(hollowGateExternalCredits(before, 'run-a'), {}, 'before snapshot is immutable');
});

test('run rewards, debit-only writes and duplicate committed writes do not create external credits', () => {
    const before = active();
    const rewarded = characterOf(versionedPlayerRecord({ character: before }, { ...before, ...wallet(1400) }, {}, { hollowGateCurrencySource: 'run' }).record);
    assert.deepEqual(hollowGateExternalCredits(rewarded, 'run-a'), {});
    const gifted = recordHollowGateExternalCredits(rewarded, { ...rewarded, ryo: 1490 });
    const spent = recordHollowGateExternalCredits(gifted, { ...gifted, ryo: 1350 });
    assert.deepEqual(hollowGateExternalCredits(spent, 'run-a'), { ryo: 90 });
    assert.deepEqual(recordHollowGateExternalCredits(spent, structuredClone(spent)), spent);
});

test('checkpoint, termination and a new token reset provenance through the production merge', () => {
    const before = recordHollowGateExternalCredits(active(), { ...active(), ryo: 1290, hollowShards: 1290 });
    const checkpoint = versionedPlayerRecord({ character: before }, before, {}, { hollowGateCurrencySource: 'checkpoint' }).record;
    const merged = mergePreservingImages(checkpoint, { character: before }) as Record<string, unknown>;
    assert.deepEqual(hollowGateExternalCredits(characterOf(merged), 'run-a'), {});
    const ended = recordHollowGateExternalCredits(before, { ...before, hollowGateRun: null }, 'run');
    assert.equal(characterOf(mergePreservingImages({ character: ended }, { character: before }) as Record<string, unknown>).hollowGateExternalCredits, null);
    const nextRun = recordHollowGateExternalCredits(before, { ...before, hollowGateRun: { runToken: 'run-b' } });
    assert.deepEqual(hollowGateExternalCredits(nextRun, 'run-b'), {});
    assert.deepEqual(hollowGateExternalCredits(before, 'different-run'), {});
});

test('generic player saves cannot forge, clear, replace or backfill external-credit provenance', () => {
    const stored = recordHollowGateExternalCredits(active(), { ...active(), ryo: 1290 });
    for (const requested of [undefined, null, { runToken: 'run-a', currencies: { ryo: 999999 } }, { runToken: 'run-b', currencies: { ryo: 999999 } }]) {
        const incoming = { ...active(), hollowGateExternalCredits: requested };
        enforceRawSaveLedgerBoundary(incoming, stored, false, structuredClone(incoming));
        assert.deepEqual(incoming.hollowGateExternalCredits, stored.hollowGateExternalCredits);
    }
    for (const firstSave of [false, true]) {
        const incoming = { ...active(), hollowGateExternalCredits: { runToken: 'run-a', currencies: { ryo: 999999 } } } as Character;
        enforceRawSaveLedgerBoundary(incoming, active(), firstSave, structuredClone(incoming));
        assert.equal(Object.hasOwn(incoming, 'hollowGateExternalCredits'), false);
    }
});

test('malformed and overflowing trusted provenance fails closed', () => {
    for (const amount of [-1, 0.5, Infinity, NaN, '90', Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => hollowGateExternalCredits({ ...active(), hollowGateExternalCredits: { runToken: 'run-a', currencies: { ryo: amount } } }, 'run-a'));
    }
    const capped = { ...active(), hollowGateExternalCredits: { runToken: 'run-a', currencies: { ryo: Number.MAX_SAFE_INTEGER } } };
    assert.throws(() => recordHollowGateExternalCredits(capped, { ...capped, ryo: 1201 }), /overflow/);
    assert.throws(() => hollowGateProtectedCurrencyBaseline(capped, 'run-a', 'ryo', 1), /overflow/);
});

test('mixed and split bank withdrawals conserve deposited ryo while preserving bank interest', () => {
    let character = { ...active(), bankRyo: 100 } as Character;
    character = recordHollowGateExternalCredits(character, { ...character, ryo: 1140, bankRyo: 160 });
    character = recordHollowGateExternalCredits(character, { ...character, ryo: 1180, bankRyo: 120 });
    assert.deepEqual(hollowGateExternalCredits(character, 'run-a'), {});
    character = recordHollowGateExternalCredits(character, { ...character, bankRyo: 130 });
    character = recordHollowGateExternalCredits(character, { ...character, ryo: 1270, bankRyo: 40 });
    assert.deepEqual(hollowGateExternalCredits(character, 'run-a'), { ryo: 70 });
    character = recordHollowGateExternalCredits(character, { ...character, ryo: 1310, bankRyo: 0 });
    assert.deepEqual(hollowGateExternalCredits(character, 'run-a'), { ryo: 110 }, 'only the original bank plus interest enters provenance');
});

test('lost acknowledgement commits wallet and provenance once; a stale CAS cannot overwrite a newer credit', async () => {
    const initial = { _saveVersion: 1, character: active() };
    let stored: Record<string, unknown> = structuredClone(initial);
    let loseAck = true;
    const store = {
        get: async <T>() => structuredClone(stored) as T,
        compareSet: async (_key: string, expected: unknown, intended: unknown) => {
            if (JSON.stringify(expected) !== JSON.stringify(stored)) return false;
            stored = structuredClone(intended) as Record<string, unknown>;
            if (loseAck) { loseAck = false; throw new Error('committed but acknowledgement lost'); }
            return true;
        },
    };
    const saved = await writeVersionedPlayerSaveWithStore(store, 'save:test', initial, { ...active(), ryo: 1290 });
    assert.equal(saved._saveVersion, 2);
    assert.deepEqual(hollowGateExternalCredits(characterOf(stored), 'run-a'), { ryo: 90 });
    await assert.rejects(writeVersionedPlayerSaveWithStore(store, 'save:test', initial, { ...active(), ryo: 1290 }), /version-conflict/);
    assert.deepEqual(hollowGateExternalCredits(characterOf(stored), 'run-a'), { ryo: 90 });
    const second = await writeVersionedPlayerSaveWithStore(store, 'save:test', stored, { ...characterOf(stored), ryo: 1310 });
    assert.deepEqual(hollowGateExternalCredits(characterOf(second.record), 'run-a'), { ryo: 110 });
});

test('authorized same-run restore derives its credit from the locked live wallet, ignoring snapshot counters', () => {
    const live = { _saveVersion: 10, character: recordHollowGateExternalCredits(active(), { ...active(), ryo: 1290 }) };
    const snapshot = { _saveVersion: 3, character: { ...active(), ryo: 1390, hollowGateExternalCredits: { runToken: 'run-a', currencies: { ryo: 999999 } } } };
    const restored = buildRestoredSave(snapshot, live, 100);
    assert.equal(restored._saveVersion, 11);
    assert.deepEqual(hollowGateExternalCredits(characterOf(restored), 'run-a'), { ryo: 190 });
    const replay = buildRestoredSave(snapshot, restored, 101);
    assert.deepEqual(hollowGateExternalCredits(characterOf(replay), 'run-a'), { ryo: 190 });
});
