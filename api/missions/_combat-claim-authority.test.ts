import assert from 'node:assert/strict';
import { test } from 'node:test';
import { _makeMemoryKv, type KvLike } from '../_storage.js';
import {
    combatMissionClaimTokenKey,
    compareSetExactKvRow,
    confirmCombatMissionClaimSave,
    createCombatMissionClaimPaymentReservation,
    createCombatMissionClaimToken,
    publishCombatMissionClaimRows,
    retireCombatMissionClaimToken,
    setExactKvRow,
    type CombatMissionClaimSettlement,
} from './_combat-claim-authority.js';

const NOW = 1_800_000_000_000;
const FINGERPRINT = 'a'.repeat(64);
const MISSION = 'combat-e-drill';

const settlement: CombatMissionClaimSettlement = {
    version: 1,
    runId: 'run-1',
    missionId: MISSION,
    rewardFingerprint: FINGERPRINT,
    settledAt: NOW,
    result: {
        reward: { xpBoosted: 40, statPoints: 0, ryo: 120, stamina: 0, territoryScrolls: 0, currency: {}, items: [] },
        combat: { aiProfileId: 'drill-dummy', missionKey: MISSION },
        completion: 'daily',
    },
    effects: { version: 1 },
};

const token = createCombatMissionClaimToken({
    playerName: 'rill', runId: 'run-1', missionId: MISSION,
    enemyProfileId: 'drill-dummy', rewardFingerprint: FINGERPRINT, wonAt: NOW - 1_000,
});

/**
 * Reads come back as Postgres returns them: the JSON form of what was written.
 * An undefined field is gone and -0 is 0. With `lostReply`, every compareSet
 * throws after it runs, and `land` says whether it commits first.
 */
function postgresStore(lostReply?: { land: boolean }): KvLike {
    const base = _makeMemoryKv();
    return {
        ...base,
        async get<T = unknown>(key: string): Promise<T | null> {
            const stored = await base.get<T>(key);
            return stored === null ? null : JSON.parse(JSON.stringify(stored)) as T;
        },
        async compareSet(key, expected, value, options) {
            if (!lostReply) return base.compareSet(key, expected, value, options);
            if (lostReply.land) await base.compareSet(key, expected, value, options);
            throw new Error('Connection terminated unexpectedly');
        },
    };
}

test('an exact compare-set is confirmed by its own read-back when the save holds an undefined field', async () => {
    // The exact-row writers read back after EVERY write, and `save:` rows are
    // never cached, so this is a clean write, not a lost reply. The save record
    // comes from mergePreservingImages, which keeps an undefined the writer set.
    const store = postgresStore();
    const previous = { _saveVersion: 1, character: { name: 'rill', ryo: 100 } };
    await store.set('save:rill', previous);
    const intended = { _saveVersion: 2, character: { name: 'rill', ryo: 220, activeStoryReckoning: undefined } };
    await compareSetExactKvRow(store, 'save:rill', previous, intended);
    assert.deepEqual(await store.get('save:rill'), { _saveVersion: 2, character: { name: 'rill', ryo: 220 } });
});

test('an exact set is confirmed by its own read-back when the value holds -0', async () => {
    const store = postgresStore();
    await setExactKvRow(store, 'save:rill', { _saveVersion: 1, character: { name: 'rill', stamina: -0 } });
    assert.deepEqual(await store.get('save:rill'), { _saveVersion: 1, character: { name: 'rill', stamina: 0 } });
});

test('publishing the token and pending save confirms both rows from their read-backs', async () => {
    const store = postgresStore();
    const expectedSave = { _saveVersion: 1, character: { name: 'rill' } };
    await store.set('save:rill', expectedSave);
    const saveRecord = { _saveVersion: 2, character: {
        name: 'rill', pendingCombatMissionClaims: [MISSION], activeStoryReckoning: undefined,
    } };
    await publishCombatMissionClaimRows({
        store,
        tokenKey: combatMissionClaimTokenKey('rill', MISSION),
        expectedToken: null,
        token,
        saveKey: 'save:rill',
        expectedSave,
        saveRecord,
    });
    assert.deepEqual(await store.get(combatMissionClaimTokenKey('rill', MISSION)), token);
});

test('a retirement that never landed is not mistaken for a successor\'s row', async () => {
    // The claim token key is not on the no-cache list, so the `expected` row a
    // worker passes can be the object it cached when it wrote it, undefined
    // fields included, while the read-back after the failed write is the JSON.
    const store = postgresStore({ land: false });
    const key = combatMissionClaimTokenKey('rill', MISSION);
    const reservation = createCombatMissionClaimPaymentReservation({
        token, playerName: 'rill', enemyProfileId: 'drill-dummy', rewardFingerprint: FINGERPRINT,
        settlement: { ...settlement, effects: { version: 1, newbieAppliedAt: undefined } },
        reservedAt: NOW,
    });
    await store.set(key, reservation);
    await assert.rejects(
        retireCombatMissionClaimToken({ store, key, expected: reservation, token: reservation, settlement }),
        /Connection terminated unexpectedly/,
        'the row is still ours, so the caller must learn the retirement did not land',
    );
    assert.equal((await store.get<{ authority: string }>(key))?.authority, 'server-combat-paying');
});

test('an ambiguous save write is confirmed from its stored receipt when the settlement holds an undefined field', async () => {
    const store = postgresStore();
    const pinned: CombatMissionClaimSettlement = {
        ...settlement,
        effects: { version: 1, newbieAppliedAt: NOW + 1, newbieRyoAwarded: undefined },
    };
    const persisted = await confirmCombatMissionClaimSave({
        write: async () => {
            await store.set('save:rill', { _saveVersion: 3, character: {
                name: 'rill', combatMissionClaimSettlements: [pinned],
            } });
            throw new Error('Connection terminated unexpectedly');
        },
        read: () => store.get<Record<string, unknown>>('save:rill'),
        settlement: pinned,
    });
    assert.equal(persisted._saveVersion, 3);
});
